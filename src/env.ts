// Server environment variables, read at startup (SvelteKit 3: exposed via $app/env/private). See .env.example.
import { defineEnvVars } from '@sveltejs/kit/env';

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const optional = (v: string | undefined) => v || undefined;

export const variables = defineEnvVars({
	ALLOWED_EMAIL_DOMAINS: { schema: list, description: 'Comma-separated email domains allowed to sign in; "*" allows anyone (dev only)' },
	ALLOWED_EMAILS: { schema: list, description: 'Comma-separated extra emails allowed to sign in' },
	SMTP_URL: { schema: optional, description: 'smtp(s)://user:pass@host:port; unset = print emails to the console' },
	MAIL_FROM: { schema: (v) => v || 'Club Predictions <no-reply@localhost>', description: 'From address for sign-in emails' },
	GOOGLE_SIGNIN_ENABLED: { schema: (v) => v !== 'false', description: 'Set to false to hide Google sign-in even when the client ID and secret are set' },
	GOOGLE_CLIENT_ID: { schema: optional, description: 'Google OAuth client ID; unset = no "Sign in with Google" button' },
	GOOGLE_CLIENT_SECRET: { schema: optional, description: 'Google OAuth client secret' },
	LINKEDIN_CLIENT_ID: { schema: optional, description: 'LinkedIn app client ID (Sign In with LinkedIn using OpenID Connect); unset = no Connect LinkedIn button' },
	LINKEDIN_CLIENT_SECRET: { schema: optional, description: 'LinkedIn app client secret' },
	GITHUB_CLIENT_ID: { schema: optional, description: 'GitHub OAuth app client ID; unset = no Connect GitHub button' },
	GITHUB_CLIENT_SECRET: { schema: optional, description: 'GitHub OAuth app client secret' },
	DISCORD_CLIENT_ID: { schema: optional, description: 'Discord app client ID; unset = no Connect Discord button' },
	DISCORD_CLIENT_SECRET: { schema: optional, description: 'Discord app client secret' },
	DISCORD_TOKEN_KEY: { schema: optional, description: 'Base64 of 32 random bytes (openssl rand -base64 32) that encrypts stored Discord tokens; required for Connect Discord. Changing it orphans stored tokens' },
	SSE_API_URL: { schema: optional, description: 'SSE website origin to mirror members/officers from, e.g. https://sse.rit.edu; unset = no sync' },
	RIT_API_KEY: { schema: optional, description: 'Bearer token for api.rit.edu (graduation term numbers); unset = term numbers from the code pattern only' },
	GITHUB_TOKEN: { schema: optional, description: 'GitHub token for SSE GitHub checks (5000/h instead of 60/h); no scopes needed' },
	DATA_DIR: { schema: (v) => v || 'data', description: 'Directory for files the app keeps, e.g. saved SSE profile pictures (default ./data)' },
	SITE_CURRENCY: { schema: (v) => v || 'DBLN', description: 'Currency code (currencies.code) that SSE memberships, check-ins and site events pay out in (default DBLN)' },
	VAPID_PUBLIC_KEY: { schema: optional, description: 'Web push public key (npx web-push generate-vapid-keys); with the other two set, members can turn on alerts on their phones' },
	VAPID_PRIVATE_KEY: { schema: optional, description: 'Web push private key, kept secret' },
	VAPID_SUBJECT: { schema: optional, description: 'mailto: or https: contact for the push service, e.g. mailto:club@example.edu' },
	SSE_SYNC_MINUTES:{ schema: (v) => Math.max(1, Number(v) || 15), description: 'Minutes between SSE roster syncs (default 15)' },
});
