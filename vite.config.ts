import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// .env -> process.env for PORT and DATABASE_URL; real environment variables win.
try {
	process.loadEnvFile();
} catch {}

export default defineConfig({
	server: { port: Number(process.env.PORT) || 5173 },
	preview: { port: Number(process.env.PORT) || 4173 },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
