// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from './generated/prisma/client.ts';

declare global {
	// Set by vite.config.ts: the short git commit the build came from.
	const __GIT_COMMIT__: string;
	// Set by vite.config.ts: when the build ran, as an ISO timestamp.
	const __DEPLOYED_AT__: string;

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
