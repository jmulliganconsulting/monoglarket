// Age gate for signup (vault "Signup and profile", Eligibility). Dates are the club's own: America/New_York.

export type Birth = { year: number; month?: number | null; day?: number | null };
export type Day = { year: number; month: number; day: number };

/**
 * 'adult', 'minor', or 'ask'. Birth year alone decides everyone but 18-year-olds; those need a month and day
 * (proposed rule, vault "Signup and profile", not yet signed off).
 */
export function ageGate(birth: Birth, today: Day): 'adult' | 'minor' | 'ask' {
	const age = today.year - birth.year;
	if (age >= 19) return 'adult';
	if (age <= 17) return 'minor';
	if (!birth.month || !birth.day) return 'ask';
	const reached = birth.month < today.month || (birth.month === today.month && birth.day <= today.day);
	return reached ? 'adult' : 'minor';
}

/** Today's calendar date where the club is. */
export function todayInNewYork(now = new Date()): Day {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
	const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return { year: n('year'), month: n('month'), day: n('day') };
}
