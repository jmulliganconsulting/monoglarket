// Onboarding: six screens between first sign-in and the app (vault "Signup and profile"). Each save checks the member is on that screen.
import { grantSignup } from '../auth/auth.ts';
import { audit } from '../audit/audit.ts';
import { Prisma, withTx, type Db, type PrismaClient } from '../db/db.ts';
import { PROGRAMS } from '../sse/majors.ts';
import { countryCode, regionCodes } from '../lib/regions.ts';
import { ageGate, todayInNewYork } from './eligibility.ts';

export const SCREENS = ['eligibility', 'name', 'school', 'status', 'optional', 'done'] as const;

export class OnboardingError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

const PREFIXES = ['', 'Mr', 'Ms', 'Mrs', 'Mx', 'Dr', 'Prof'];
const RESERVED = ['admin', 'mod', 'moderator', 'house', 'sse', 'system', 'support', 'club', 'predictions', 'root', 'api', 'null'];
const SENIORITY = ['incoming', 'first', 'second', 'third', 'fourth', 'fifth', 'bs_ms', 'masters', 'phd'];
const STATUSES = ['current', 'alum', 'faculty', 'none'];
const TERMS = ['SPRING', 'SUMMER', 'FALL'];
const PROGRAM_KEYS = new Set(PROGRAMS.map(([name, degree]) => `${name}|${degree}`));

// Messages for codes; the screens show these.
export const onboardingMessages: Record<string, string> = {
	out_of_order: 'That screen is done. Continue where you left off.',
	terms_required: 'Accept the rules to continue.',
	state_required: 'Pick your state.',
	state_invalid: 'Pick your province or territory from the list.',
	birth_year_invalid: 'Enter the year you were born.',
	birth_date_invalid: 'That date does not exist.',
	birthday_required: 'Add your birthday, or untick the rewards box.',
	birth_month_day_required: 'You turned 18 this year, so add your birth month and day.',
	country_required: 'Enter your country.',
	name_required: 'Enter your first and last name.',
	preferred_name_invalid: 'Preferred name: 1 to 60 characters.',
	username_invalid: 'Username: 3 to 20 letters, numbers or underscores.',
	username_reserved: 'That username is reserved. Pick another.',
	username_taken: 'Someone already has that username.',
	prefix_invalid: 'Pick a prefix from the list.',
	status_invalid: 'Pick one of the options.',
	seniority_required: 'Pick your level.',
	program_required: 'Pick at least one major.',
	program_invalid: 'That major is not on the list.',
	graduation_invalid: 'Check the graduation term and year.',
};

export const onboardingMessage = (e: unknown) => {
	const code = (e as { code?: string })?.code;
	return code && code in onboardingMessages ? onboardingMessages[code] : 'Something went wrong. Try again.';
};

const fail = (code: string) => {
	throw new OnboardingError(code);
};
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isMonthDay = (year: number, month: number, day: number) => {
	const d = new Date(Date.UTC(year, month - 1, day));
	return month >= 1 && month <= 12 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};

/** The next screen a member should see, or null when onboarding is over. */
export const screenFor = (u: { onboardingStep: number; onboardedAt: Date | null }) => (u.onboardedAt ? null : SCREENS[u.onboardingStep] ?? null);

function assertScreen(user: { onboardingStep: number; onboardedAt: Date | null }, index: number) {
	if (user.onboardedAt || user.onboardingStep !== index) fail('out_of_order');
}

type Eligibility = { birthYear: number; birthMonth: number | null; birthDay: number | null; birthdayRewards?: boolean; country: string; state: string; city?: string; accepted: boolean };

/**
 * Screen 1. Under 18: the account is deleted and only a block row is kept, so the member can't sign in again.
 * Returns 'blocked' for that case, 'ok' otherwise.
 */
export async function saveEligibility(prisma: PrismaClient, userId: number, input: Eligibility, now = new Date()): Promise<'ok' | 'blocked'> {
	const today = todayInNewYork(now);
	if (!Number.isInteger(input.birthYear) || input.birthYear < 1900 || input.birthYear > today.year) fail('birth_year_invalid');
	const hasMonth = input.birthMonth != null;
	const hasDay = input.birthDay != null;
	if (hasMonth !== hasDay || (hasMonth && !isMonthDay(input.birthYear, input.birthMonth!, input.birthDay!))) fail('birth_date_invalid');
	const country = countryCode(input.country);
	if (!country) fail('country_required');
	const regions = regionCodes(country);
	if (country === 'US' && !regions.has(input.state)) fail('state_required');
	if (input.state && regions.size && !regions.has(input.state)) fail('state_invalid');
	if (!input.accepted) fail('terms_required');
	const gate = ageGate({ year: input.birthYear, month: input.birthMonth, day: input.birthDay }, today);
	if (gate === 'ask') fail('birth_month_day_required');
	// Month and day are kept only when the member asks for birthday rewards (vault "Birthday").
	const keepBirthday = !!input.birthdayRewards;
	if (keepBirthday && !hasMonth) fail('birthday_required');

	return withTx(prisma, async (db) => {
		const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
		assertScreen(user, 0);
		await audit(db, userId, 'onboarding_eligibility', null, 'eligibility and terms accepted');
		if (gate === 'minor') {
			await db.signupBlock.create({ data: { email: user.email ?? '', reason: 'under_18' } });
			await db.user.delete({ where: { id: userId } }); // cascades the session: nothing else they typed is kept
			await audit(db, null, 'signup_blocked', null, 'under 18 at sign-up; account removed');
			return 'blocked';
		}
		await db.user.update({
			where: { id: userId },
			data: {
				country,
				state: text(input.state, 60) || null,
				// City is optional. Kept so city-level rules can be applied later.
				city: text(input.city, 60) || null,
				birthMonth: keepBirthday ? input.birthMonth : null,
				birthDay: keepBirthday ? input.birthDay : null,
				birthdaySetAt: keepBirthday ? now : null,
				termsAcceptedAt: now,
				onboardingStep: 1,
			},
		});
		return 'ok';
	});
}

type Name = { prefix: string; firstName: string; middleName: string; lastName: string; suffix: string; preferredName: string; username: string; pronouns: string; pronounsPublic: boolean };

/** Screen 2. Preferred name becomes the public name; the username is unique ignoring case. */
export async function saveName(prisma: PrismaClient, userId: number, input: Name) {
	const firstName = text(input.firstName, 50);
	const lastName = text(input.lastName, 50);
	if (!firstName || !lastName) fail('name_required');
	if (!PREFIXES.includes(input.prefix)) fail('prefix_invalid');
	const preferredName = text(input.preferredName, 60) || `${firstName} ${lastName}`;
	if (preferredName.length > 60) fail('preferred_name_invalid');
	const username = text(input.username, 20).toLowerCase();
	if (!/^[a-z0-9_]{3,20}$/.test(username)) fail('username_invalid');
	if (RESERVED.includes(username)) fail('username_reserved');

	try {
		return await withTx(prisma, async (db) => {
			assertScreen(await db.user.findUniqueOrThrow({ where: { id: userId } }), 1);
			await audit(db, userId, 'onboarding_name', null, 'name and username saved');
			await db.user.update({
				where: { id: userId },
				data: {
					namePrefix: input.prefix || null,
					firstName,
					middleName: text(input.middleName, 50) || null,
					lastName,
					nameSuffix: text(input.suffix, 10) || null,
					preferredName,
					displayName: preferredName,
					username,
					pronouns: text(input.pronouns, 40) || null,
					pronounsPublic: input.pronounsPublic,
					onboardingStep: 2,
				},
			});
		});
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') fail('username_taken');
		throw e;
	}
}

type School = { status: string; seniority: string; onCoopTerm: boolean; isTransfer: boolean; programs: string[]; graduationTerm: string; graduationYear: number | null };

/** Screen 3. Current students pick a level and at least one major; other statuses may skip the majors. */
export async function saveSchool(prisma: PrismaClient, userId: number, input: School) {
	if (!STATUSES.includes(input.status)) fail('status_invalid');
	const current = input.status === 'current';
	if (current && !SENIORITY.includes(input.seniority)) fail('seniority_required');
	const programs = [...new Set(input.programs)];
	if (current && programs.length === 0) fail('program_required');
	if (programs.some((p) => !PROGRAM_KEYS.has(p))) fail('program_invalid');
	const term = input.graduationTerm || null;
	if (term && !TERMS.includes(term)) fail('graduation_invalid');
	if (input.graduationYear != null && !(Number.isInteger(input.graduationYear) && input.graduationYear >= 1950 && input.graduationYear <= 2100)) fail('graduation_invalid');

	return withTx(prisma, async (db) => {
		assertScreen(await db.user.findUniqueOrThrow({ where: { id: userId } }), 2);
		await audit(db, userId, 'onboarding_school', null, `${programs.length} programs saved`);
		await db.user.update({
			where: { id: userId },
			data: {
				studentStatus: input.status,
				seniority: current ? input.seniority : null,
				onCoopTerm: current && input.onCoopTerm,
				isTransfer: current && input.isTransfer,
				graduationTerm: term,
				graduationYear: input.graduationYear,
				onboardingStep: 3,
			},
		});
		await db.userProgram.deleteMany({ where: { userId } });
		await db.userProgram.createMany({
			data: programs.map((key, sort) => {
				const [program, degree] = key.split('|');
				return { userId, program, degree, sort };
			}),
		});
	});
}

/** Screens 4 and 5 have nothing to save: they show status, and optional links live on /account. */
export async function advanceFrom(prisma: PrismaClient, userId: number, index: 3 | 4) {
	return withTx(prisma, async (db) => {
		assertScreen(await db.user.findUniqueOrThrow({ where: { id: userId } }), index);
		await audit(db, userId, 'onboarding_step', null, `screen ${index + 1} done`);
		await db.user.update({ where: { id: userId }, data: { onboardingStep: index + 1 } });
	});
}

/** Screen 6: the signup grant is paid here, and only here. */
export async function finishOnboarding(prisma: PrismaClient, userId: number, now = new Date()) {
	return withTx(prisma, async (db: Db) => {
		assertScreen(await db.user.findUniqueOrThrow({ where: { id: userId } }), 5);
		await audit(db, userId, 'onboarding_done', null, 'signup grant paid');
		await grantSignup(db, userId);
		await db.user.update({ where: { id: userId }, data: { onboardingStep: 6, onboardedAt: now } });
	});
}

/** Where a member on screen `screen` should be sent instead, or null if they belong here. */
export function elsewhere(user: { onboardingStep: number; onboardedAt: Date | null }, screen: (typeof SCREENS)[number]) {
	const next = screenFor(user);
	if (!next) return '/';
	return next === screen ? null : `/onboarding/${next}`;
}
