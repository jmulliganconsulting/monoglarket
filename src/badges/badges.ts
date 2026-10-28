// Badges on profiles and onboarding (vault "Signup and profile", "Status badges"). Achievements are worked out from the rows, not stored.
import type { PrismaClient } from '../db/db.ts';

export type Badge = { label: string; group: 'site' | 'official' | 'achievement' | 'school'; colour?: string; icon?: string; outline?: boolean };

type Member = { status: string; isMentor: boolean; isMember: boolean; membershipCount?: number } | null;

// Colour and icon from the Status badges table in the vault (Signup and profile). Member is outline only, so it has no fill colour.
const STYLE: Record<string, Pick<Badge, 'colour' | 'icon' | 'outline'>> = {
  'Site administrator': { colour: '#8daecb', icon: 'settings' },
  'Site moderator': { colour: '#607d8b', icon: 'gavel' },
  'SE Staff': { colour: '#908aec', icon: 'school' },
  'Primary officer': { colour: '#f1c40f', icon: 'star' },
  Officer: { colour: '#e91e63', icon: 'shield' },
  Mentor: { colour: '#3498db', icon: 'bulb' },
  Member: { icon: 'id-badge-2', outline: true },
};

const badge = (style: string, group: Badge['group'], label = style): Badge => ({ label, group, ...STYLE[style] });

/** Site roles and club records. Guests get none. Highest first. */
export function statusBadges(user: { role: string; primaryOfficerSince?: Date | null }, member: Member): Badge[] {
  const out: Badge[] = [];
  if (user.role === 'admin') out.push(badge('Site administrator', 'site'));
  if (user.role === 'moderator') out.push(badge('Site moderator', 'site'));
  if (user.primaryOfficerSince) out.push(badge('Primary officer', 'official'));
  if (member?.status === 'se_staff') out.push(badge('SE Staff', 'official'));
  if (member?.status === 'officer') out.push(badge('Officer', 'official'));
  if (member?.isMentor) out.push(badge('Mentor', 'official'));
  if (member?.isMember) out.push(badge('Member', 'official', member.membershipCount ? `Member × ${member.membershipCount}` : 'Member'));
  return out;
}

const SENIORITY: Record<string, string> = {
  incoming: 'Incoming',
  first: 'First year',
  second: 'Second year',
  third: 'Third year',
  fourth: 'Fourth year',
  fifth: 'Fifth year',
  bs_ms: 'BS/MS',
  masters: "Master's",
  phd: 'PhD',
};

/** Shown after the name on the profile, never as a chip (vault "Seniority"). */
export function seniorityLabel(seniority: string | null): string | null {
  return seniority ? (SENIORITY[seniority] ?? null) : null;
}

/** School badges (vault "School"): Current student, Transfer, and every major. Seniority is not a badge, see seniorityLabel. */
export function schoolBadges(user: { studentStatus: string | null; isTransfer: boolean }, programs: { program: string; degree: string }[]): Badge[] {
  const out: Badge[] = [];
  if (user.studentStatus === 'current') out.push({ label: 'Current student', group: 'school', colour: '#e67e22', icon: 'backpack' });
  if (user.studentStatus === 'alum') out.push({ label: 'Alum', group: 'school', colour: '#2a9859', icon: 'school' });
  if (user.isTransfer) out.push({ label: 'Transfer student', group: 'school', colour: '#e67e22', icon: 'transfer' });
  for (const p of programs) out.push({ label: `${p.program} · ${p.degree}`, group: 'school', colour: '#e67e22', icon: 'book' });
  return out;
}

/** Colour of the highest badge that has one. Members and guests keep the default colour. */
export function roleColour(badges: Badge[]): string | undefined {
  return badges.find((b) => b.colour)?.colour;
}

/** Earned by what the member has done on the site. */
export async function achievements(prisma: PrismaClient, userId: number): Promise<Badge[]> {
  const [trades, held, upheld] = await Promise.all([
    prisma.trade.count({ where: { userId } }),
    prisma.position.findMany({
      where: { userId, shares: { gt: 0 }, market: { status: { in: ['resolved', 'final'] } } },
      select: { outcomeId: true, market: { select: { resolvedOutcomeId: true } } },
    }),
    prisma.report.count({ where: { reporterId: userId, status: 'upheld' } }),
  ]);
  const won = held.filter((p) => p.outcomeId === p.market.resolvedOutcomeId).length;
  const out: Badge[] = [];
  if (trades >= 1) out.push({ label: 'First trade', group: 'achievement', colour: '#9fe288' });
  if (trades >= 25) out.push({ label: 'Regular', group: 'achievement', colour: '#9fe288' });
  if (won >= 1) out.push({ label: 'Called it', group: 'achievement', colour: '#9fe288' });
  if (upheld >= 1) out.push({ label: 'Good catch', group: 'achievement', colour: '#9fe288' });
  return out;
}
