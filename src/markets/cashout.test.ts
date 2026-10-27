// Early sales and cash out (vault ADR-021): every sale before resolution pays the fee to the house,
// a cash out sells the whole position, and the ledger still balances.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { floorCoins, floorShares, proceedsForSell } from '../engine/lmsr.ts';
import { netOfFee, sellFee } from '../engine/fees.ts';
import { approveMarket, buy, createMarket, grant, lockMarket, resolve, sell } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));
const house = () => withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)));

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator' } })).id;
  for (const id of [mod, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

async function openBinary() {
  const marketId = await createMarket(pool, {
    question: 'Will it rain at the bake sale?',
    criteria: 'Weather service record',
    currencyId: coin,
    outcomes: ['Yes', 'No'],
    subsidy: 70,
    closeAt: tomorrow(),
    spendCap: 100000,
  });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const outcomes = await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } });
  return { marketId, yes: outcomes[0].id, no: outcomes[1].id };
}

test('a cash out sells the whole position, the house keeps the fee, and the ledger balances', async () => {
  const { marketId, yes } = await openBinary();
  const wallet0 = await wallet(ana);
  const house0 = await house();
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 100, minShares: 0, idempotencyKey: 'ana-buy-cash' });
  const shares = (await pool.position.findUniqueOrThrow({ where: { userId_outcomeId: { userId: ana, outcomeId: yes } } })).shares.toNumber();

  const market = await pool.market.findUniqueOrThrow({ where: { id: marketId } });
  const q = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.q.toNumber());
  const gross = floorCoins(proceedsForSell(q, market.b, 0, floorShares(shares)));

  const t = await sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 'all', minProceeds: 0, idempotencyKey: 'ana-cash-out' });

  assert.equal(t.fee, sellFee(gross));
  assert.equal(t.amount, netOfFee(gross));
  assert.equal(t.amount + t.fee, gross);
  assert.equal(await wallet(ana), wallet0 - 100 + netOfFee(gross));
  assert.equal((await house()) - house0, sellFee(gross));
  assert.equal((await pool.position.findUniqueOrThrow({ where: { userId_outcomeId: { userId: ana, outcomeId: yes } } })).shares.toNumber(), 0);
  assert.deepEqual(await withTx(pool, (db) => checkLedger(db)), []);
});

test('a partial sell pays the same fee, so splitting a cash out does not avoid it', async () => {
  const { marketId, yes } = await openBinary();
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 100, minShares: 0, idempotencyKey: 'ana-buy-partial' });
  const t = await sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 10, minProceeds: 0, idempotencyKey: 'ana-partial' });
  assert.ok(t.fee > 0);
  assert.equal(t.fee, sellFee(t.amount + t.fee));
});

test('a cash out is refused while the market is locked, and the holding stays put', async () => {
  const { marketId, yes } = await openBinary();
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 50, minShares: 0, idempotencyKey: 'ana-buy-lock' });
  await lockMarket(pool, { marketId, moderatorId: mod });
  await assert.rejects(sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 'all', minProceeds: 0, idempotencyKey: 'ana-lock-cash' }), { code: 'market_locked' });
  assert.ok((await pool.position.findUniqueOrThrow({ where: { userId_outcomeId: { userId: ana, outcomeId: yes } } })).shares.toNumber() > 0);
});

test('a cash out is refused once the market has resolved', async () => {
  const { marketId, yes, no } = await openBinary();
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 50, minShares: 0, idempotencyKey: 'ana-buy-resolved' });
  await resolve(pool, { marketId, outcomeId: no, moderatorId: mod });
  await assert.rejects(sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 'all', minProceeds: 0, idempotencyKey: 'ana-late-cash' }), { code: 'market_closed' });
});

test('a member with nothing to cash out is refused, and a price that falls short of the minimum is refused', async () => {
  const { marketId, yes } = await openBinary();
  await assert.rejects(sell(pool, { userId: ben, marketId, outcomeId: yes, shares: 'all', minProceeds: 0, idempotencyKey: 'ben-nothing' }), { code: 'not_enough_shares' });
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 50, minShares: 0, idempotencyKey: 'ana-buy-guard' });
  await assert.rejects(sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 'all', minProceeds: 100000, idempotencyKey: 'ana-guard-cash' }), { code: 'price_moved' });
});
