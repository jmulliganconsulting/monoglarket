import nodemailer from 'nodemailer';
import { MAIL_FROM, SMTP_URL } from '$app/env/private';

// No SMTP_URL (local dev): print the email to the server console instead of sending it.
const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

export async function sendLoginEmail(to: string, code: string, linkUrl: string) {
	const subject = `${code} is your Club Predictions sign-in code`;
	const text = `Your sign-in code is ${code}\n\nOr open this link to sign in:\n${linkUrl}\n\nThe code and link work once and expire in 15 minutes. If you didn't ask to sign in, ignore this email.`;
	if (!transport) {
		console.log(`\n[dev email] to ${to}\n${subject}\n${text}\n`);
		return;
	}
	await transport.sendMail({ from: MAIL_FROM, to, subject, text });
}
