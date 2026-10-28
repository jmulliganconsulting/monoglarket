// What members see for each AuthError code.
export const authMessages: Record<string, string> = {
	bad_email: "That doesn't look like an email address.",
	not_allowed: "That email isn't on the club's list. Use your school email, or ask a club officer to add you.",
	too_many_requests: 'Too many codes requested. Wait an hour and try again.',
	wrong_code: "That code isn't right. Check the email and try again.",
	code_expired: 'That code has expired or been used too many times. Send a new one.',
	wrong_password: "That email and password don't match. Forgot it? Sign in another way and set a new one on your account page.",
	weak_password: 'Use at least 8 characters.',
	google_failed: "Google sign-in didn't work. Try again.",
	blocked: "This account can't use MonoGlarket. Contact a club admin.",
	link_expired: 'That link has expired or was already used. Sign in again to get a new one.',
};

export const messageFor = (e: unknown) => {
	const code = (e as { code?: string })?.code;
	if (code && code in authMessages) return authMessages[code];
	throw e;
};
