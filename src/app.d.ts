// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from './generated/prisma/client.ts';

declare global {
	// Set by vite.config.ts: the short git commit the build came from.
	const __GIT_COMMIT__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			user: User | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
