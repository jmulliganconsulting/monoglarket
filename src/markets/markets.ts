// Market creation, review, trading, resolution. Design: vault notes "Market lifecycle", "Trade flow", "Resolving markets", "Resolution and payouts".
import { RetryableConflict, withTx, type Db, type PrismaClient } from '../db/db.ts';
import type { Market } from '../generated/prisma/client.ts';
import { bForSubsidy, floorCoins, floorShares, prices, proceedsForSell, sharesForSpend } from '../engine/lmsr.ts';
import { sellFee } from '../engine/fees.ts';
import { account, balance, LedgerError, postTransaction, type Entry } from '../ledger/ledger.ts';
import { isModerator } from '../auth/roles.ts';
import { audit } from '../audit/audit.ts';
import { isResolverSource } from '../resolvers/sources.ts';
import { onBreak } from '../users/users.ts';
import { notifyHolders, notifyInvolved } from '../notifications/notify.ts';
import { isHttpsUrl, MAX_PROOFS, type ProofInput } from '../proofs/proofs.ts';

export class MarketError extends LedgerError {}

/** NFR-05: what one member may spend on one market unless a moderator sets another cap. */
export const DEFAULT_SPEND_CAP = 500;

/** Give a member internal dabloons from the mint (signup grant, allowance). */
export async function grant(prisma: PrismaClient, userId: number, currencyId: number, amount: number, idempotencyKey: string) {
  return withTx(prisma, async (db) =>
    postTransaction(db, {
      kind: 'grant',
      currencyId,
      idempotencyKey,
      entries: [
        { accountId: await account(db, 'mint', 0, currencyId), amount: -amount },
        { accountId: await account(db, 'user', userId, currencyId), amount },
      ],
    }),
  );
}

type NewMarket = {
  question: string;
  criteria: string;
  currencyId: number;
  outcomes: string[];
  /** A people market: the SSE member behind each outcome, in the same order as outcomes. */
  outcomeSseMemberIds?: number[];
  subsidy: number;
  /** Null = no set close date: trading stays open until a moderator closes or resolves it. */
  closeAt: Date | null;
  creatorId?: number;
  spendCap?: number;
  categoryId?: number;
  /** Trading locks at this time and stays locked until the market is resolved (vault "Market lock"). */
  lockAt?: Date;
  colorPrimary?: string;
  colorSecondary?: string;
  /** Set for each option of a several-winner question (ADR-020). */
  questionGroupId?: number;
  optionLabel?: string;
  optionDate?: Date;
  /** Set with optionDate on a date question: 'on' = the event happened on that day, 'by' = on or before it. */
  dateMatch?: 'on' | 'by';
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A member proposes a market. Nothing moves and nothing trades until a moderator approves it. */
export async function createMarket(prisma: PrismaClient, m: NewMarket): Promise<number> {
  return withTx(prisma, (db) => createMarketIn(db, m));
}

async function createMarketIn(db: Db, m: NewMarket): Promise<number> {
  if (!m.question.trim() || !m.criteria.trim()) throw new MarketError('missing_text');
  if (m.outcomes.length < 2 || m.outcomes.length > 10) throw new MarketError('bad_outcome_count');
  if (!Number.isSafeInteger(m.subsidy) || m.subsidy <= 0) throw new MarketError('bad_subsidy');
  if (m.closeAt && !(m.closeAt > new Date())) throw new MarketError('bad_close');
  if (m.spendCap !== undefined && !(Number.isSafeInteger(m.spendCap) && m.spendCap > 0)) throw new MarketError('bad_spend_cap');
  if (m.lockAt && !(m.lockAt > new Date() && (!m.closeAt || m.lockAt < m.closeAt))) throw new MarketError('bad_lock_time');
  for (const c of [m.colorPrimary, m.colorSecondary]) if (c !== undefined && !HEX.test(c)) throw new MarketError('bad_colour');
  if (m.creatorId) {
    const creator = await db.user.findUnique({ where: { id: m.creatorId }, select: { breakUntil: true } });
    if (creator && onBreak(creator)) throw new MarketError('on_break');
  }
  const market = await db.market.create({
    data: {
      question: m.question.trim(),
      resolutionCriteria: m.criteria.trim(),
      currencyId: m.currencyId,
      b: bForSubsidy(m.subsidy, m.outcomes.length),
      subsidy: m.subsidy,
      spendCap: m.spendCap ?? DEFAULT_SPEND_CAP,
      status: 'pending_review',
      closeAt: m.closeAt,
      creatorId: m.creatorId,
      categoryId: m.categoryId ?? null,
      lockAt: m.lockAt ?? null,
      colorPrimary: m.colorPrimary ?? null,
      colorSecondary: m.colorSecondary ?? null,
      outcomes: { create: m.outcomes.map((label, sort) => ({ label: label.trim(), sort, sseMemberId: m.outcomeSseMemberIds?.[sort] ?? null })) },
      questionGroupId: m.questionGroupId ?? null,
      optionLabel: m.optionLabel ?? null,
      optionDate: m.optionDate ?? null,
      dateMatch: m.dateMatch ?? null,
    },
  });
  await audit(db, m.creatorId ?? null, 'create_market', market.id, m.question.trim().slice(0, 100));
  return market.id;
}

/**
 * A several-winner question (ADR-020): one yes/no market per option, created together in one transaction.
 * Each option gets the full subsidy, so the house's worst case is subsidy × options.
 */
export async function createQuestionGroup(
  prisma: PrismaClient,
  g: Omit<NewMarket, 'outcomes' | 'questionGroupId' | 'optionLabel'> & { options: string[] },
): Promise<number> {
  const { options, ...shared } = g;
  if (options.length < 2 || options.length > 10) throw new MarketError('bad_outcome_count');
  if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) throw new MarketError('duplicate_option');
  return createGroupIn(prisma, shared, options.map((label) => ({ label })));
}

/**
 * A date question: one yes/no option per day, "On or before this day", which wins if the event happened by the end of that day.
 * Settled by resolveDateQuestion. (Older questions may still have an "On" option for a day; dateOptionWins handles both.)
 */
export async function createDateQuestion(
  prisma: PrismaClient,
  g: Omit<NewMarket, 'outcomes' | 'questionGroupId' | 'optionLabel' | 'optionDate' | 'dateMatch'> & { days: { day: Date; text: string }[] },
): Promise<number> {
  const { days, ...shared } = g;
  if (days.length < 1 || days.length > 10) throw new MarketError('bad_outcome_count');
  if (days.some((d) => Number.isNaN(d.day.getTime()))) throw new MarketError('bad_date');
  const options = days.map(({ day, text }) => ({ label: `On or before ${text}`, optionDate: day, dateMatch: 'by' as const }));
  if (new Set(options.map((o) => o.label)).size !== options.length) throw new MarketError('duplicate_option');
  return createGroupIn(prisma, shared, options);
}

async function createGroupIn(prisma: PrismaClient, shared: Omit<NewMarket, 'outcomes' | 'questionGroupId' | 'optionLabel'>, options: { label: string; optionDate?: Date; dateMatch?: 'on' | 'by' }[]) {
  return withTx(prisma, async (db) => {
    const group = await db.questionGroup.create({
      data: { question: shared.question.trim(), resolutionCriteria: shared.criteria.trim(), closeAt: shared.closeAt, creatorId: shared.creatorId ?? null },
    });
    for (const o of options)
      await createMarketIn(db, { ...shared, outcomes: ['Yes', 'No'], questionGroupId: group.id, optionLabel: o.label.trim(), optionDate: o.optionDate, dateMatch: o.dateMatch });
    await audit(db, shared.creatorId ?? null, 'create_question', null, `${options.length} options: ${shared.question.trim().slice(0, 80)}`);
    return group.id;
  });
}

/** Moderator approves: the house funds the subsidy into the market pool and trading opens. Optionally attaches a resolver source. */
export async function approveMarket(prisma: PrismaClient, r: { marketId: number; moderatorId: number; resolverSource?: string | null; resolutionMode?: 'auto_confirm' | 'auto' }) {
  return withTx(prisma, (db) => approveIn(db, r));
}

/**
 * Approve the pending options of a several-winner question together, or none of them (one transaction).
 * Options a moderator already approved one by one from the queue are left as they are.
 */
export async function approveQuestionGroup(prisma: PrismaClient, r: { groupId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const options = await db.market.findMany({ where: { questionGroupId: r.groupId }, select: { id: true, status: true }, orderBy: { id: 'asc' } });
    if (options.length === 0) throw new MarketError('not_found');
    const pending = options.filter((o) => o.status === 'pending_review');
    if (pending.length === 0) throw new MarketError('not_pending');
    for (const o of pending) await approveIn(db, { marketId: o.id, moderatorId: r.moderatorId });
  });
}

async function approveIn(db: Db, r: { marketId: number; moderatorId: number; resolverSource?: string | null; resolutionMode?: 'auto_confirm' | 'auto' }) {
  if (r.resolverSource && !isResolverSource(r.resolverSource)) throw new MarketError('bad_resolver');
  // Only an admin can make an automatic answer final without a moderator confirming it (ADR-012).
  const mode = r.resolverSource ? (r.resolutionMode ?? 'auto_confirm') : 'manual';
  if (mode === 'auto' && (await db.user.findUniqueOrThrow({ where: { id: r.moderatorId }, select: { role: true } })).role !== 'admin') throw new MarketError('auto_needs_admin');
  const { market } = await claimMarket(db, r.marketId);
  if (market.status !== 'pending_review') throw new MarketError('not_pending');
  if (market.closeAt && market.closeAt <= new Date()) throw new MarketError('bad_close');
  await postTransaction(db, {
    kind: 'subsidy',
    currencyId: market.currencyId,
    idempotencyKey: `subsidy:${market.id}`,
    marketId: market.id,
    entries: [
      { accountId: await account(db, 'house', 0, market.currencyId), amount: -market.subsidy },
      { accountId: await account(db, 'market', market.id, market.currencyId), amount: market.subsidy },
    ],
  });
  await db.market.update({ where: { id: market.id }, data: { status: 'open', resolverSource: r.resolverSource ?? null, resolutionMode: mode } });
  await audit(db, r.moderatorId, 'approve', market.id, `subsidy ${market.subsidy}${r.resolverSource ? `, resolver ${r.resolverSource}, ${mode}` : ''}`);
}

/** Moderator rejects a proposed market. Nothing was funded, so nothing to refund. */
export async function rejectMarket(prisma: PrismaClient, r: { marketId: number; moderatorId: number; reason: string }) {
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, r.marketId);
    if (market.status !== 'pending_review') throw new MarketError('not_pending');
    await db.market.update({ where: { id: market.id }, data: { status: 'rejected' } });
    await audit(db, r.moderatorId, 'reject', market.id, r.reason);
  });
}

/** Create and approve in one step. For the seed and tests only; the app goes through createMarket and approveMarket. */
export async function openMarket(prisma: PrismaClient, m: NewMarket & { moderatorId: number }): Promise<{ marketId: number; outcomeIds: number[] }> {
  const marketId = await createMarket(prisma, m);
  await approveMarket(prisma, { marketId, moderatorId: m.moderatorId });
  const outcomes = await prisma.outcome.findMany({ where: { marketId, removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true } });
  return { marketId, outcomeIds: outcomes.map((o) => o.id) };
}

type Claimed = { market: Market; outcomeIds: number[]; q: number[] };

/**
 * Bump the market's version before reading its outcomes. A concurrent writer waits on the row, then
 * matches 0 rows and retries via withTx — same effect as SELECT ... FOR UPDATE, but portable (ADR-015).
 */
async function claimMarket(db: Db, marketId: number): Promise<Claimed> {
  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) throw new MarketError('not_found');
  const r = await db.market.updateMany({ where: { id: marketId, version: market.version }, data: { version: { increment: 1 } } });
  if (r.count !== 1) throw new RetryableConflict();
  const outcomes = await db.outcome.findMany({ where: { marketId, removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, q: true } });
  return { market, outcomeIds: outcomes.map((o) => o.id), q: outcomes.map((o) => o.q.toNumber()) };
}

async function priorTrade(db: Db, idempotencyKey: string) {
  return (await db.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { trade: true } }))?.trade;
}

function assertOpen(market: Market) {
  if (market.status !== 'open' || (market.closeAt && market.closeAt <= new Date())) throw new MarketError('market_closed');
  if (market.lockedAt) throw new MarketError('market_locked');
}

/**
 * Lock trading now (vault "Market lock"). There is no unlock: the lock stays until the market is resolved or cancelled.
 * The version bump makes a trade already in flight retry and see the lock.
 */
export async function lockMarket(prisma: PrismaClient, r: { marketId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, r.marketId);
    if (market.status !== 'open') throw new MarketError('not_lockable');
    if (market.lockedAt) throw new MarketError('already_locked');
    await db.market.update({ where: { id: market.id }, data: { lockedAt: new Date(), lockAt: null } });
    await audit(db, r.moderatorId, 'lock', market.id, '');
  });
}

/** Lock trading automatically at `lockAt` (checked by runMarketJobs). Pass null to cancel a scheduled lock. */
export async function scheduleLock(prisma: PrismaClient, r: { marketId: number; moderatorId: number; lockAt: Date | null }) {
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, r.marketId);
    if (market.status !== 'open') throw new MarketError('not_lockable');
    if (r.lockAt && (!(r.lockAt > new Date()) || (market.closeAt && r.lockAt >= market.closeAt))) throw new MarketError('bad_lock_time');
    await db.market.update({ where: { id: market.id }, data: { lockAt: r.lockAt } });
    await audit(db, r.moderatorId, 'schedule_lock', market.id, r.lockAt ? r.lockAt.toISOString() : 'cancelled');
  });
}

/** Members on a break can't trade or request resolution (vault "Take a break"). Payouts and refunds still arrive. */
async function assertNoBreak(db: Db, userId: number) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { breakUntil: true } });
  if (onBreak(u)) throw new MarketError('on_break');
}

/** Spend `spend` dabloons on an outcome. Fails with price_moved if it would buy fewer than minShares. */
export async function buy(
  prisma: PrismaClient,
  t: { userId: number; marketId: number; outcomeId: number; spend: number; minShares: number; idempotencyKey: string },
) {
  if (!Number.isSafeInteger(t.spend) || t.spend <= 0) throw new MarketError('bad_amount');
  return withTx(prisma, async (db) => {
    const prior = await priorTrade(db, t.idempotencyKey);
    if (prior) return prior;
    const { market, outcomeIds, q } = await claimMarket(db, t.marketId);
    assertOpen(market);
    await assertNoBreak(db, t.userId);
    const i = outcomeIds.indexOf(t.outcomeId);
    if (i < 0) throw new MarketError('bad_outcome');

    const shares = floorShares(sharesForSpend(q, market.b, i, t.spend));
    if (shares < t.minShares) throw new MarketError('price_moved');
    if (market.spendCap != null) {
      const spent = (await db.position.aggregate({ where: { marketId: t.marketId, userId: t.userId }, _sum: { netSpent: true } }))._sum.netSpent ?? 0;
      if (spent + t.spend > market.spendCap) throw new MarketError('position_cap');
    }
    return record(db, market, q, i, t, shares, -t.spend);
  });
}

/**
 * Sell `shares` of an outcome back to the market, or pass 'all' to cash out the whole position (vault ADR-021).
 * Every sale pays the early-sale fee (src/engine/fees.ts). Fails with price_moved if what the member receives is below minProceeds.
 */
export async function sell(
  prisma: PrismaClient,
  t: { userId: number; marketId: number; outcomeId: number; shares: number | 'all'; minProceeds: number; idempotencyKey: string },
) {
  const requested = t.shares === 'all' ? null : floorShares(t.shares);
  if (requested !== null && !(requested > 0)) throw new MarketError('bad_amount');
  return withTx(prisma, async (db) => {
    const prior = await priorTrade(db, t.idempotencyKey);
    if (prior) return prior;
    const { market, outcomeIds, q } = await claimMarket(db, t.marketId);
    assertOpen(market);
    await assertNoBreak(db, t.userId);
    const i = outcomeIds.indexOf(t.outcomeId);
    if (i < 0) throw new MarketError('bad_outcome');

    // Read the holding inside the transaction, so a cash out sells exactly what the member holds at that moment.
    const held = (await db.position.findUnique({ where: { userId_outcomeId: { userId: t.userId, outcomeId: t.outcomeId } } }))?.shares.toNumber() ?? 0;
    const shares = requested ?? floorShares(held);
    if (!(shares > 0) || shares > held) throw new MarketError('not_enough_shares');
    const gross = floorCoins(proceedsForSell(q, market.b, i, shares));
    const fee = sellFee(gross);
    const proceeds = gross - fee;
    if (proceeds < t.minProceeds) throw new MarketError('price_moved');
    if (proceeds <= 0) throw new MarketError('too_small');
    return record(db, market, q, i, t, -shares, proceeds, fee);
  });
}

/** Shared tail of buy/sell. `shares` signed (+buy), `userAmount` signed dabloons to the user (-buy), `fee` kept by the house (sells). */
async function record(db: Db, market: Market, q: number[], i: number, t: { userId: number; outcomeId: number; idempotencyKey: string }, shares: number, userAmount: number, fee = 0) {
  const before = prices(q, market.b)[i];
  q[i] += shares;
  const after = prices(q, market.b)[i];
  const transactionId = await postTransaction(db, {
    kind: 'trade',
    currencyId: market.currencyId,
    idempotencyKey: t.idempotencyKey,
    marketId: market.id,
    entries: [
      { accountId: await account(db, 'user', t.userId, market.currencyId), amount: userAmount },
      { accountId: await account(db, 'market', market.id, market.currencyId), amount: -(userAmount + fee) },
      ...(fee > 0 ? [{ accountId: await account(db, 'house', 0, market.currencyId), amount: fee }] : []),
    ],
  });
  await db.outcome.update({ where: { id: t.outcomeId }, data: { q: { increment: shares } } });
  const change = { shares: { increment: shares }, netSpent: { increment: -userAmount } };
  await db.position.upsert({
    where: { userId_outcomeId: { userId: t.userId, outcomeId: t.outcomeId } },
    create: { userId: t.userId, outcomeId: t.outcomeId, marketId: market.id, shares, netSpent: -userAmount },
    update: change,
  });
  const trade = await db.trade.create({
    data: { marketId: market.id, userId: t.userId, outcomeId: t.outcomeId, shares, amount: Math.abs(userAmount), fee, probBefore: before, probAfter: after, transactionId },
  });
  await audit(db, t.userId, shares > 0 ? 'buy' : 'sell', market.id, `trade ${trade.id}, outcome ${t.outcomeId}, ${shares} shares, ${Math.abs(userAmount)}${fee ? `, fee ${fee}` : ''}`);
  return trade;
}

/**
 * Propose a winner with evidence. Only moderators, admins and members an admin has granted this market to
 * (grantResolver) can propose; ordinary members can't (vault "Resolution and payouts"). A moderator's proposal waits for a
 * different moderator to confirm (two-moderator rule). An admin's proposal, or a granted member's, resolves at once.
 * A newer proposal supersedes the pending one. `proofs` are links, pictures or files saved with the proposal.
 */
export async function propose(prisma: PrismaClient, p: { marketId: number; outcomeId: number; proposerId: number; evidence: string; proofs?: ProofInput[] }) {
  const evidence = p.evidence.trim();
  if (!evidence) throw new MarketError('evidence_required');
  const proofs = p.proofs ?? [];
  if (proofs.length > MAX_PROOFS) throw new MarketError('too_many_proofs');
  for (const pr of proofs) if (pr.kind === 'link' && !isHttpsUrl(pr.url)) throw new MarketError('bad_link');
  return withTx(prisma, async (db) => {
    const { market, outcomeIds } = await claimMarket(db, p.marketId);
    if (market.status !== 'open' && market.status !== 'closed') throw new MarketError('not_resolvable');
    if (!outcomeIds.includes(p.outcomeId)) throw new MarketError('bad_outcome');
    const proposer = await db.user.findUniqueOrThrow({ where: { id: p.proposerId }, select: { role: true, breakUntil: true } });
    if (onBreak(proposer)) throw new MarketError('on_break');
    const granted = !!(await db.marketResolver.findUnique({ where: { marketId_userId: { marketId: p.marketId, userId: p.proposerId } } }));
    if (!isModerator(proposer.role) && !granted) throw new MarketError('not_allowed');
    const trusted = proposer.role === 'admin' || granted;
    await db.resolutionProposal.updateMany({ where: { marketId: p.marketId, status: 'pending' }, data: { status: 'superseded' } });
    const proposal = await db.resolutionProposal.create({
      data: {
        marketId: p.marketId,
        outcomeId: p.outcomeId,
        proposerId: p.proposerId,
        evidence,
        status: trusted ? 'accepted' : 'pending',
        decidedAt: trusted ? new Date() : null,
        attachments: { create: proofs.map(proofRow) },
      },
    });
    await audit(db, p.proposerId, 'propose', market.id, `proposal ${proposal.id}, outcome ${p.outcomeId}, ${trusted ? 'resolves now' : 'waits for a moderator'}, ${proofs.length} proof`);
    if (trusted) await resolveIn(db, { marketId: p.marketId, outcomeId: p.outcomeId, moderatorId: p.proposerId });
    return proposal;
  });
}

function proofRow(pr: ProofInput) {
  return pr.kind === 'link'
    ? { kind: 'link', url: pr.url, label: pr.label }
    : { kind: pr.kind, storedName: pr.storedName, originalName: pr.originalName, mimeType: pr.mimeType, sizeBytes: pr.sizeBytes, label: pr.label };
}

/** An admin lets one member resolve one market (vault "Auth and roles"). Revoke with revokeResolver. */
export async function grantResolver(prisma: PrismaClient, r: { marketId: number; userId: number; adminId: number }) {
  return withTx(prisma, async (db) => {
    const market = await db.market.findUnique({ where: { id: r.marketId }, select: { status: true } });
    if (!market) throw new MarketError('not_found');
    if (!['pending_review', 'open', 'closed'].includes(market.status)) throw new MarketError('not_resolvable');
    if (!(await db.user.findUnique({ where: { id: r.userId }, select: { id: true } }))) throw new MarketError('not_found');
    await db.marketResolver.upsert({
      where: { marketId_userId: { marketId: r.marketId, userId: r.userId } },
      create: { marketId: r.marketId, userId: r.userId, grantedBy: r.adminId },
      update: {},
    });
    await audit(db, r.adminId, 'grant_resolver', r.marketId, `user ${r.userId}`);
  });
}

export async function revokeResolver(prisma: PrismaClient, r: { grantId: number; adminId: number }) {
  return withTx(prisma, async (db) => {
    const grant = await db.marketResolver.findUnique({ where: { id: r.grantId } });
    if (!grant) throw new MarketError('not_found');
    await db.marketResolver.delete({ where: { id: r.grantId } });
    await audit(db, r.adminId, 'revoke_resolver', grant.marketId, `user ${grant.userId}`);
  });
}

/**
 * An automatic source answered for a closed market. It waits for a moderator to confirm (ADR-012). Returns null when
 * the same answer is already waiting, so the job can run every few minutes without piling up proposals.
 */
export async function proposeFromResolver(prisma: PrismaClient, r: { marketId: number; outcomeId: number; evidence: string }) {
  return withTx(prisma, async (db) => {
    const { market, outcomeIds } = await claimMarket(db, r.marketId);
    if (market.status !== 'closed') throw new MarketError('not_resolvable');
    if (!outcomeIds.includes(r.outcomeId)) throw new MarketError('bad_outcome');
    const waiting = await db.resolutionProposal.findFirst({ where: { marketId: r.marketId, source: 'resolver', outcomeId: r.outcomeId, status: 'pending' } });
    if (waiting) return null;
    await db.resolutionProposal.updateMany({ where: { marketId: r.marketId, source: 'resolver', status: 'pending' }, data: { status: 'superseded' } });
    const proposal = await db.resolutionProposal.create({ data: { marketId: r.marketId, outcomeId: r.outcomeId, proposerId: null, source: 'resolver', evidence: r.evidence, status: 'pending' } });
    await audit(db, null, 'resolver_propose', r.marketId, `proposal ${proposal.id}, outcome ${r.outcomeId}`);
    if (market.resolutionMode !== 'auto') return proposal;
    // 'auto' markets: the source's answer is the result at once, with no moderator in the loop (ADR-012).
    await db.resolutionProposal.update({ where: { id: proposal.id }, data: { status: 'accepted', decidedAt: new Date() } });
    await audit(db, null, 'resolver_accept', r.marketId, `proposal ${proposal.id}, automatic`);
    await resolveIn(db, { marketId: r.marketId, outcomeId: r.outcomeId, moderatorId: null });
    return proposal;
  });
}

/** A moderator accepts a pending proposal: the market resolves and payouts follow in the same transaction. */
export async function acceptProposal(prisma: PrismaClient, r: { proposalId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const p = await db.resolutionProposal.findUnique({ where: { id: r.proposalId } });
    if (!p) throw new MarketError('not_found');
    // the status check and write are one UPDATE, so two moderators accepting at once can't both win
    const acceptor = await db.user.findUniqueOrThrow({ where: { id: r.moderatorId }, select: { role: true } });
    if (!isModerator(acceptor.role)) throw new MarketError('not_moderator');
    // two-moderator rule: whoever proposed can't also confirm (admins are exempt, see propose)
    if (p.proposerId === r.moderatorId) throw new MarketError('second_moderator_needed');
    const decided = await db.resolutionProposal.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'accepted', decidedAt: new Date() } });
    if (decided.count !== 1) throw new MarketError('not_pending');
    await audit(db, r.moderatorId, 'accept', p.marketId, `proposal ${p.id}`);
    await resolveIn(db, { marketId: p.marketId, outcomeId: p.outcomeId, moderatorId: r.moderatorId });
  });
}

export async function rejectProposal(prisma: PrismaClient, r: { proposalId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const p = await db.resolutionProposal.findUnique({ where: { id: r.proposalId } });
    if (!p) throw new MarketError('not_found');
    const decided = await db.resolutionProposal.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'rejected', decidedAt: new Date() } });
    if (decided.count !== 1) throw new MarketError('not_pending');
    await audit(db, r.moderatorId, 'reject_proposal', p.marketId, `proposal ${p.id}`);
  });
}

/** Pay each winning share 1 dabloon (rounded down) from the pool; opens the 24 h dispute window. */
export async function resolve(prisma: PrismaClient, r: { marketId: number; outcomeId: number; moderatorId: number }) {
  return withTx(prisma, (db) => resolveIn(db, r));
}

const DISPUTE_MS = 24 * 3600_000;

/** Pay each winning share (rounded down) from the pool to its holder. `key` makes the payout idempotent. */
async function payOut(db: Db, market: Market, outcomeId: number, key: string) {
  const winners = await db.position.findMany({ where: { outcomeId, shares: { gte: 1 } }, select: { userId: true, shares: true } });
  const entries: Entry[] = [];
  for (const w of winners) entries.push({ accountId: await account(db, 'user', w.userId, market.currencyId), amount: Math.floor(w.shares.toNumber()) });
  const total = entries.reduce((s, e) => s + e.amount, 0);
  if (total > 0) {
    entries.push({ accountId: await account(db, 'market', market.id, market.currencyId), amount: -total });
    await postTransaction(db, { kind: 'payout', currencyId: market.currencyId, idempotencyKey: key, marketId: market.id, entries });
  }
}

async function resolveIn(db: Db, r: { marketId: number; outcomeId: number; moderatorId: number | null }) {
  const { market, outcomeIds } = await claimMarket(db, r.marketId);
  if (market.status !== 'open' && market.status !== 'closed') throw new MarketError('not_resolvable');
  if (!outcomeIds.includes(r.outcomeId)) throw new MarketError('bad_outcome');
  // A scheduled automatic result has no person behind it, so there is no position to check.
  // Admins may resolve a market they hold a position in, for testing; moderators may not.
  if (r.moderatorId !== null && (await db.user.findUniqueOrThrow({ where: { id: r.moderatorId }, select: { role: true } })).role !== 'admin')
    await assertNoPosition(db, r.marketId, r.moderatorId);

  await payOut(db, market, r.outcomeId, `payout:${market.id}`);
  await db.market.update({
    where: { id: r.marketId },
    data: { status: 'resolved', resolvedOutcomeId: r.outcomeId, resolvedBy: r.moderatorId, resolvedAt: new Date(), disputeUntil: new Date(Date.now() + DISPUTE_MS) },
  });
  await db.resolutionProposal.updateMany({ where: { marketId: r.marketId, status: 'pending' }, data: { status: 'superseded' } });
  await audit(db, r.moderatorId, 'resolve', market.id, `outcome ${r.outcomeId}`);
  // An option of a question names itself, so a member with several options gets one alert per option they bet on.
  const result = await winnerLabel(db, r.outcomeId);
  const text = market.optionLabel ? `${market.question}: ${market.optionLabel} ${result === 'Yes' ? 'won' : 'lost'}.` : `${market.question}: ${result} won.`;
  await notifyInvolved(db, market.id, 'resolved', text);
}

const DAY_MS = 86_400_000;

/** Did the event at `at` make this date option win? Days are UTC. */
export function dateOptionWins(match: 'on' | 'by', day: Date, at: Date) {
  const start = day.getTime();
  return match === 'on' ? at.getTime() >= start && at.getTime() < start + DAY_MS : at.getTime() < start + DAY_MS;
}

/**
 * A date question: the event happened at `at`. Every open option is settled from that one time (see dateOptionWins), in one transaction.
 * A pending option stops the whole thing.
 */
export async function resolveDateQuestion(prisma: PrismaClient, r: { groupId: number; moderatorId: number; at: Date }) {
  if (Number.isNaN(r.at.getTime())) throw new MarketError('bad_date');
  return withTx(prisma, async (db) => {
    // A future time is refused, except for admins testing (they may resolve as if the event already happened).
    if (r.at > new Date() && (await db.user.findUniqueOrThrow({ where: { id: r.moderatorId }, select: { role: true } })).role !== 'admin') throw new MarketError('bad_date');
    const options = await db.market.findMany({
      where: { questionGroupId: r.groupId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, optionDate: true, dateMatch: true, outcomes: { where: { removedAt: null }, select: { id: true, label: true } } },
    });
    if (options.some((o) => o.status === 'pending_review')) throw new MarketError('not_resolvable');
    const open = options.filter((o) => o.status === 'open' || o.status === 'closed');
    if (open.length === 0 || open.some((o) => o.optionDate === null || o.dateMatch === null)) throw new MarketError('not_resolvable');
    for (const o of open) {
      const label = dateOptionWins(o.dateMatch as 'on' | 'by', o.optionDate!, r.at) ? 'Yes' : 'No';
      await resolveIn(db, { marketId: o.id, outcomeId: o.outcomes.find((x) => x.label === label)!.id, moderatorId: r.moderatorId });
    }
  });
}

async function winnerLabel(db: Db, outcomeId: number) {
  return (await db.outcome.findUniqueOrThrow({ where: { id: outcomeId }, select: { label: true } })).label;
}

/** Void the market: refund each member max(0, net_spent); house covers any gap (ADR-010). */
export async function cancel(prisma: PrismaClient, r: { marketId: number; moderatorId: number; reason?: string }) {
  const reason = (r.reason ?? '').trim().slice(0, 500);
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, r.marketId);
    if (market.status !== 'open' && market.status !== 'closed') throw new MarketError('not_cancellable');
    await assertNoPosition(db, r.marketId, r.moderatorId);

    const spent = await db.position.groupBy({ by: ['userId'], where: { marketId: r.marketId }, _sum: { netSpent: true } });
    const entries: Entry[] = [];
    for (const u of spent)
      if ((u._sum.netSpent ?? 0) > 0) entries.push({ accountId: await account(db, 'user', u.userId, market.currencyId), amount: u._sum.netSpent ?? 0 });
    const total = entries.reduce((s, e) => s + e.amount, 0);
    if (total > 0) {
      const poolAcct = await account(db, 'market', market.id, market.currencyId);
      const fromPool = Math.min(total, await balance(db, poolAcct));
      entries.push({ accountId: poolAcct, amount: -fromPool });
      if (total > fromPool) entries.push({ accountId: await account(db, 'house', 0, market.currencyId), amount: -(total - fromPool) });
      await postTransaction(db, { kind: 'refund', currencyId: market.currencyId, idempotencyKey: `refund:${market.id}`, marketId: market.id, memo: reason ? `Cancelled: ${reason}` : 'Cancelled', entries });
    }
    await db.market.update({ where: { id: r.marketId }, data: { status: 'cancelled', resolvedAt: new Date(), cancelReason: reason || null } });
    await db.resolutionProposal.updateMany({ where: { marketId: r.marketId, status: 'pending' }, data: { status: 'superseded' } });
    await audit(db, r.moderatorId, 'cancel', market.id, reason);
    await sweep(db, market);
    await notifyInvolved(db, market.id, 'cancelled', `${market.question} was cancelled${reason ? `: ${reason}` : '.'} Anything you paid in was refunded.`);
  });
}

/** After the dispute window: move what's left in the pool to the house and lock the market. */
export async function finalise(prisma: PrismaClient, marketId: number) {
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, marketId);
    if (market.status !== 'resolved') throw new MarketError('not_resolved');
    await sweep(db, market);
    await db.market.update({ where: { id: marketId }, data: { status: 'final' } });
    await audit(db, null, 'finalise', marketId, '');
  });
}

/**
 * Scheduled job (hooks.server.ts, every minute): stop trading at close_at, finalise markets whose dispute window has ended.
 * Idempotent: a second run finds nothing to do.
 */
export async function runMarketJobs(prisma: PrismaClient, now = new Date()) {
  const due = await prisma.market.findMany({ where: { status: 'open', closeAt: { lte: now } }, select: { id: true } });
  for (const { id } of due)
    await withTx(prisma, async (db) => {
      // version bump makes any trade already in flight on this market retry and see it closed
      const r = await db.market.updateMany({ where: { id, status: 'open' }, data: { status: 'closed', version: { increment: 1 } } });
      if (r.count === 1) await audit(db, null, 'close', id, '');
    });
  // Scheduled locks: once per market, the lockAt is cleared when it fires.
  const lockDue = await prisma.market.findMany({ where: { status: 'open', lockedAt: null, lockAt: { lte: now } }, select: { id: true } });
  for (const { id } of lockDue)
    await withTx(prisma, async (db) => {
      const r = await db.market.updateMany({ where: { id, status: 'open', lockedAt: null, lockAt: { lte: now } }, data: { lockedAt: now, lockAt: null, version: { increment: 1 } } });
      if (r.count === 1) await audit(db, null, 'auto_lock', id, '');
    });
  const finished = await prisma.market.findMany({ where: { status: 'resolved', disputeUntil: { lte: now } }, select: { id: true } });
  for (const { id } of finished) await finalise(prisma, id);
  return { closed: due.length, finalised: finished.length };
}

async function sweep(db: Db, market: Market) {
  const poolAcct = await account(db, 'market', market.id, market.currencyId);
  const left = await balance(db, poolAcct);
  if (left === 0) return;
  await postTransaction(db, {
    kind: 'sweep',
    currencyId: market.currencyId,
    idempotencyKey: `sweep:${market.id}`,
    marketId: market.id,
    entries: [
      { accountId: poolAcct, amount: -left },
      { accountId: await account(db, 'house', 0, market.currencyId), amount: left },
    ],
  });
}

async function assertNoPosition(db: Db, marketId: number, userId: number) {
  if (await db.position.findFirst({ where: { marketId, userId, shares: { gt: 0 } } })) throw new MarketError('conflict_of_interest');
}

/**
 * Re-resolve inside the 24 h dispute window (vault "Resolution and payouts"). Everything the market has paid out so far is
 * reversed exactly, then the new winners are paid. The window starts again. The person who set the result before can't
 * change it, and a winner who already spent their dabloons can go below zero (payout_reversal is the only kind allowed to).
 */
export async function reResolve(prisma: PrismaClient, r: { marketId: number; outcomeId: number; moderatorId: number; evidence: string }) {
  const evidence = r.evidence.trim();
  if (!evidence) throw new MarketError('evidence_required');
  return withTx(prisma, async (db) => {
    const { market, outcomeIds } = await claimMarket(db, r.marketId);
    if (market.status !== 'resolved' || !market.disputeUntil || market.disputeUntil <= new Date()) throw new MarketError('dispute_closed');
    if (!outcomeIds.includes(r.outcomeId)) throw new MarketError('bad_outcome');
    if (r.outcomeId === market.resolvedOutcomeId) throw new MarketError('same_outcome');
    const moderator = await db.user.findUniqueOrThrow({ where: { id: r.moderatorId }, select: { role: true } });
    if (!isModerator(moderator.role)) throw new MarketError('not_moderator');
    if (market.resolvedBy === r.moderatorId) throw new MarketError('second_moderator_needed');
    await assertNoPosition(db, r.marketId, r.moderatorId);

    // Net effect of every payout so far, per account. Reversing it returns each dabloon exactly where it came from.
    const rows = await db.ledgerEntry.findMany({ where: { transaction: { marketId: market.id, kind: { in: ['payout', 'payout_reversal'] } } }, select: { accountId: true, amount: true } });
    const net = new Map<number, number>();
    for (const row of rows) net.set(row.accountId, (net.get(row.accountId) ?? 0) + row.amount);
    const reversal = [...net].filter(([, amount]) => amount !== 0).map(([accountId, amount]) => ({ accountId, amount: -amount }));
    const revisions = await db.ledgerTransaction.count({ where: { marketId: market.id, kind: 'payout_reversal' } });
    if (reversal.length) await postTransaction(db, { kind: 'payout_reversal', currencyId: market.currencyId, idempotencyKey: `reversal:${market.id}:${revisions}`, marketId: market.id, entries: reversal });

    await payOut(db, market, r.outcomeId, `payout:${market.id}:${revisions + 1}`);
    await db.market.update({
      where: { id: r.marketId },
      data: { resolvedOutcomeId: r.outcomeId, resolvedBy: r.moderatorId, resolvedAt: new Date(), disputeUntil: new Date(Date.now() + DISPUTE_MS) },
    });
    await db.resolutionProposal.create({ data: { marketId: r.marketId, outcomeId: r.outcomeId, proposerId: r.moderatorId, source: 'member', evidence, status: 'accepted', decidedAt: new Date() } });
    await audit(db, r.moderatorId, 're_resolve', market.id, `outcome ${r.outcomeId}: ${evidence.slice(0, 200)}`);
    await notifyInvolved(db, market.id, 'resolved', `${market.question}: the result changed to ${await winnerLabel(db, r.outcomeId)}.`);
  });
}

/** Refund a removed option's holders (their net spend on it), with the reason. Shares on it are worth nothing afterwards. */
export async function removeOutcome(prisma: PrismaClient, r: { outcomeId: number; moderatorId: number; reason: string }) {
  const reason = r.reason.trim();
  if (reason.length < 5) throw new MarketError('reason_required');
  return withTx(prisma, async (db) => {
    const outcome = await db.outcome.findUnique({ where: { id: r.outcomeId }, select: { marketId: true, label: true, removedAt: true } });
    if (!outcome || outcome.removedAt) throw new MarketError('bad_outcome');
    const { market, outcomeIds } = await claimMarket(db, outcome.marketId);
    if (market.status !== 'open' && market.status !== 'closed' && market.status !== 'pending_review') throw new MarketError('not_editable');
    if (outcomeIds.length <= 2) throw new MarketError('too_few_outcomes');

    const holders = await db.position.groupBy({ by: ['userId'], where: { outcomeId: r.outcomeId, netSpent: { gt: 0 } }, _sum: { netSpent: true } });
    // The house pays this refund, not the pool: the pool's money still backs the options that remain (their maximum
    // payout is what the pool must cover), so taking it out would break that guarantee.
    const entries: Entry[] = [];
    for (const h of holders) entries.push({ accountId: await account(db, 'user', h.userId, market.currencyId), amount: h._sum.netSpent ?? 0 });
    const total = entries.reduce((s, e) => s + e.amount, 0);
    if (total > 0) {
      entries.push({ accountId: await account(db, 'house', 0, market.currencyId), amount: -total });
      await postTransaction(db, { kind: 'refund', currencyId: market.currencyId, idempotencyKey: `option-refund:${r.outcomeId}`, marketId: market.id, memo: `Option removed: “${outcome.label}”. ${reason}`, entries });
    }
    await db.position.updateMany({ where: { outcomeId: r.outcomeId }, data: { shares: 0, netSpent: 0 } });
    await db.outcome.update({ where: { id: r.outcomeId }, data: { removedAt: new Date(), q: 0 } });
    await audit(db, r.moderatorId, 'remove_option', market.id, `${outcome.label}: ${reason}`);
    if (holders.length)
      await db.notification.createMany({ data: holders.map((h) => ({ userId: h.userId, kind: 'cancelled', marketId: market.id, text: `“${outcome.label}” was removed from ${market.question}. ${reason} Your dabloons on it were refunded.` })) });
  });
}

/** Add an option. It starts with no shares; the other prices shift to make room for it. Up to 10 active options. */
export async function addOutcome(prisma: PrismaClient, r: { marketId: number; moderatorId: number; label: string }) {
  const label = r.label.trim().slice(0, 80);
  if (!label) throw new MarketError('missing_text');
  return withTx(prisma, async (db) => {
    const { market, outcomeIds } = await claimMarket(db, r.marketId);
    if (market.status === 'resolved' || market.status === 'final' || market.status === 'cancelled' || market.status === 'rejected') throw new MarketError('not_editable');
    if (outcomeIds.length >= 10) throw new MarketError('bad_outcome_count');
    const last = await db.outcome.findFirst({ where: { marketId: market.id }, orderBy: { sort: 'desc' }, select: { sort: true } });
    await db.outcome.create({ data: { marketId: market.id, label, sort: (last?.sort ?? -1) + 1 } });
    await audit(db, r.moderatorId, 'add_option', market.id, label);
  });
}

/** Admin edits a market's words and times. Visuals, options and visibility have their own actions. */
export async function editMarket(prisma: PrismaClient, r: { marketId: number; adminId: number; question: string; criteria: string; closeAt: Date | null; categoryId: number | null }) {
  const question = r.question.trim();
  const criteria = r.criteria.trim();
  if (!question || !criteria) throw new MarketError('missing_text');
  return withTx(prisma, async (db) => {
    const { market } = await claimMarket(db, r.marketId);
    if (market.status !== 'pending_review' && market.status !== 'open' && market.status !== 'closed') throw new MarketError('not_editable');
    if (r.closeAt && !(r.closeAt > new Date())) throw new MarketError('bad_close');
    // A headliner belongs to its category: moving the market clears the pick.
    await db.market.update({ where: { id: market.id }, data: { question, resolutionCriteria: criteria, closeAt: r.closeAt, categoryId: r.categoryId, ...(r.categoryId !== market.categoryId ? { headliner: false } : {}) } });
    await audit(db, r.adminId, 'edit_market', market.id, r.closeAt ? `closes ${r.closeAt.toISOString()}` : 'no set close date');
  });
}

/**
 * Edit a whole question in one go: its words, how it resolves, and when it closes. Every option gets the same change,
 * so the options never disagree. Refused once any option has been settled or cancelled.
 */
export async function editQuestion(prisma: PrismaClient, r: { groupId: number; adminId: number; question: string; criteria: string; closeAt: Date | null; categoryId: number | null }) {
  const question = r.question.trim();
  const criteria = r.criteria.trim();
  if (!question || !criteria) throw new MarketError('missing_text');
  return withTx(prisma, async (db) => {
    const group = await db.questionGroup.findUnique({ where: { id: r.groupId }, select: { id: true, question: true, resolutionCriteria: true, closeAt: true } });
    if (!group) throw new MarketError('not_found');
    const options = await db.market.findMany({ where: { questionGroupId: r.groupId, deletedAt: null }, select: { status: true, categoryId: true } });
    // Once any option is settled, only the category can change: the words and close time are what the result was decided on.
    const settled = options.some((o) => !['pending_review', 'open', 'closed'].includes(o.status));
    if (settled && (question !== group.question || criteria !== group.resolutionCriteria || (r.closeAt?.getTime() ?? null) !== (group.closeAt?.getTime() ?? null))) throw new MarketError('not_editable');
    if (!settled && r.closeAt && !(r.closeAt > new Date())) throw new MarketError('bad_close');
    // Every option moves category together. A headliner belongs to its category, so a move clears the pick (as for a single market).
    const moved = options.some((o) => o.categoryId !== r.categoryId);
    if (!settled) await db.questionGroup.update({ where: { id: r.groupId }, data: { question, resolutionCriteria: criteria, closeAt: r.closeAt } });
    await db.market.updateMany({
      where: { questionGroupId: r.groupId, deletedAt: null },
      data: settled ? { categoryId: r.categoryId, ...(moved ? { headliner: false } : {}) } : { question, resolutionCriteria: criteria, closeAt: r.closeAt, categoryId: r.categoryId, ...(moved ? { headliner: false } : {}) },
    });
    await audit(db, r.adminId, 'edit_question', null, `${options.length} options, ${settled ? 'category only (settled)' : r.closeAt ? `closes ${r.closeAt.toISOString()}` : 'no set close date'}`);
  });
}

/** Who may see a market (vault "Market visibility"). Moderators see everything; admins also see deleted ones. */
export async function setVisibility(prisma: PrismaClient, r: { marketId: number; moderatorId: number; visibility: string; groupId: number | null }) {
  if (!['public', 'hidden', 'group'].includes(r.visibility)) throw new MarketError('bad_visibility');
  if (r.visibility === 'group' && !r.groupId) throw new MarketError('bad_visibility');
  return withTx(prisma, async (db) => {
    const market = await db.market.findUnique({ where: { id: r.marketId }, select: { id: true } });
    if (!market) throw new MarketError('not_found');
    if (r.visibility === 'group' && !(await db.userGroup.findUnique({ where: { id: r.groupId! }, select: { id: true } }))) throw new MarketError('bad_visibility');
    await db.market.update({ where: { id: r.marketId }, data: { visibility: r.visibility, groupId: r.visibility === 'group' ? r.groupId : null } });
    await audit(db, r.moderatorId, 'visibility', r.marketId, r.visibility === 'group' ? `group ${r.groupId}` : r.visibility);
  });
}

/**
 * Delete a market (admin). An open or closed market is cancelled first, so members are refunded; the reason goes to
 * members as the cancel reason, and the private reason stays with admins. Rows are kept (the ledger needs them): the
 * market just stops appearing anywhere but the admin panel.
 */
export async function deleteMarket(prisma: PrismaClient, r: { marketId: number; adminId: number; reason: string }) {
  const reason = r.reason.trim();
  if (reason.length < 5) throw new MarketError('reason_required');
  const market = await prisma.market.findUnique({ where: { id: r.marketId }, select: { status: true, deletedAt: true } });
  if (!market || market.deletedAt) throw new MarketError('not_found');
  if (market.status === 'open' || market.status === 'closed') await cancel(prisma, { marketId: r.marketId, moderatorId: r.adminId, reason: 'Withdrawn by an administrator.' });
  await withTx(prisma, async (db) => {
    await db.market.update({ where: { id: r.marketId }, data: { deletedAt: new Date(), deleteReason: reason } });
    await audit(db, r.adminId, 'delete_market', r.marketId, reason);
  });
}
