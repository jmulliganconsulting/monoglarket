// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from './generated/prisma/client.ts';

declare global {
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
