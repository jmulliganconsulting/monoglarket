import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

// .env -> process.env for PORT and DATABASE_URL; real environment variables win.
try {
	process.loadEnvFile();
} catch {}

// Shown in the footer. Builds without git (e.g. a slim Docker image) show "unknown".
const gitCommit = (() => {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return 'unknown';
	}
})();

export default defineConfig({
	server: { port: Number(process.env.PORT) || 5173 },
	preview: { port: Number(process.env.PORT) || 4173 },
	define: { __GIT_COMMIT__: JSON.stringify(gitCommit) },
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
