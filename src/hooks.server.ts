import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { checkRequest, type Verdict } from './ratelimit/ratelimit.ts';
import { DATA_DIR, GITHUB_TOKEN, RIT_API_KEY, SITE_CURRENCY, SSE_API_URL, SSE_SYNC_MINUTES, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '$app/env/private';
import { sendPendingPushes, webPushSender } from './notifications/push.ts';
import { getSession } from './auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { SESSION_COOKIE, setSessionCookie } from '#lib/server/session.ts';
import { join } from 'node:path';
import { syncSse } from './sse/sync.ts';
import { settleEarnings } from './earn/earn.ts';
import { runMarketJobs } from './markets/markets.ts';
import { runResolvers } from './resolvers/resolvers.ts';
import { startHub } from './live/hub.ts';
import { runNotifications } from './notifications/notify.ts';
import { runAllowance } from './allowance/allowance.ts';

// Keep the SSE mirror fresh, then pay out sitecurrency for what it (and our own event records) show. One timer per process: Vite dev re-runs init on reload.
export const init: ServerInit = () => {
	const g = globalThis as unknown as { sseTimer?: NodeJS.Timeout; marketTimer?: NodeJS.Timeout; resolverTimer?: NodeJS.Timeout; pushTimer?: NodeJS.Timeout; liveStop?: () => void; hourlyTimer?: NodeJS.Timeout };
	// Web push alerts go out once a minute, only when VAPID keys are set (vault "Alerts").
	if (!g.pushTimer && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
		const send = webPushSender({ publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT });
		g.pushTimer = setInterval(() => sendPendingPushes(prisma, send).catch((e) => console.error('Push job failed:', e.message)), 60_000);
	}
	// Live prices: one timer per process (vault "Live prices").
	if (!g.liveStop) g.liveStop = startHub(prisma);
	// Hourly: weekly allowances (FR-15) and the reminders for closing and overdue markets (FR-20, FR-24).
	if (!g.hourlyTimer)
		g.hourlyTimer = setInterval(() => {
			runAllowance(prisma).catch((e) => console.error('Allowance job failed:', e.message));
			runNotifications(prisma).catch((e) => console.error('Notification job failed:', e.message));
		}, 60 * 60_000);
	// Close trading at close_at and finalise markets after their dispute window (vault "Market lifecycle").
	if (!g.marketTimer) g.marketTimer = setInterval(() => runMarketJobs(prisma).catch((e) => console.error('Market jobs failed:', e.message)), 60_000);
	// Trusted sources are asked every 5 min for closed markets; their answers wait for a moderator (vault "Resolving markets").
	if (!g.resolverTimer) g.resolverTimer = setInterval(() => runResolvers(prisma).catch((e) => console.error('Resolver job failed:', e.message)), 5 * 60_000);
	if (g.sseTimer) return;
	const baseUrl = SSE_API_URL;
	const opts = baseUrl && { baseUrl, imageDir: join(DATA_DIR, 'sse-images'), ritApiKey: RIT_API_KEY, gitHubToken: GITHUB_TOKEN };
	let running = false; // the first run downloads every picture and can outlast the interval
	const settle = async () => {
		const currency = await prisma.currency.findUnique({ where: { code: SITE_CURRENCY } });
		if (!currency) return console.warn(`Earning: no currency with code ${SITE_CURRENCY}; set SITE_CURRENCY`);
		const r = await settleEarnings(prisma, currency.id);
		if (r.posted) console.log(`Earning: ${r.posted} changes, net ${r.net} ${SITE_CURRENCY}`);
	};
	const run = () => {
		if (running) return;
		running = true;
		(opts ? syncSse(prisma, opts) : Promise.resolve(null))
			.then((r) => r && console.log(`SSE sync: ${r.members} users, ${r.officers} active officer positions (${r.officerRoles} all-time), ${r.mentors} mentors, ${r.profilesFetched} profiles read, ${r.events} events, ${r.attendanceFetched} attendance lists (${r.checkins} check-ins); ${r.gitHubChecked} GitHub checks, ${r.imagesSaved} pictures saved, ${r.imagesFailed} failed`))
			.catch((e) => console.error('SSE sync failed:', e.message))
			.then(settle) // also after a failed sync: the mirror still holds the last good copy
			.catch((e) => console.error('Earning failed:', e.message))
			.finally(() => (running = false));
	};
	run();
	g.sseTimer = setInterval(run, SSE_SYNC_MINUTES * 60_000);
};

// Pages anyone can reach without signing in.
const PUBLIC = ['/login', '/health', '/favicon.ico', '/terms', '/privacy'];

// Every response carries the rate-limit headers (vault ADR-026), including redirects and 429s.
function withLimit(res: Response, v: Verdict): Response {
	res.headers.set('X-RateLimit-Limit', String(v.limit));
	res.headers.set('X-RateLimit-Remaining', String(v.remaining));
	res.headers.set('X-RateLimit-Reset', String(v.resetSeconds));
	return res;
}

function redirectTo(location: string): Response {
	return new Response(null, { status: 303, headers: { location } });
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const session = await getSession(prisma, token);
	event.locals.user = session?.user ?? null;
	if (session && token) setSessionCookie(event.cookies, token, session.expiresAt);
	else if (token) event.cookies.delete(SESSION_COOKIE, { path: '/' });

	const user = event.locals.user;
	const path = event.url.pathname;
	const verdict = checkRequest(user ? `u:${user.id}` : `ip:${event.getClientAddress()}`, path);
	if (!verdict.allowed) return withLimit(new Response('Too many requests. Wait and try again.', { status: 429, headers: { 'Retry-After': String(verdict.resetSeconds) } }), verdict);
	if (!user && !PUBLIC.some((p) => path === p || path.startsWith(p + '/'))) return withLimit(redirectTo('/login'), verdict);
	// Onboarding first: nothing else is open until the member has finished the screens (vault "Signup and profile").
	if (user && !user.onboardedAt && ![...PUBLIC, '/onboarding', '/logout'].some((p) => path === p || path.startsWith(p + '/'))) return withLimit(redirectTo('/onboarding'), verdict);
	return withLimit(await resolve(event), verdict);
};
