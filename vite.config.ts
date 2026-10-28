import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

// .env -> process.env for PORT and DATABASE_URL; real environment variables win.
try {
	process.loadEnvFile();
} catch {}

// Shown in the footer. Builds without git (e.g. a slim Docker image) show "unknown".
// Uncommitted or untracked files add "-dirty", so a local build never passes for the commit it came from.
const gitCommit = (() => {
	try {
		const git = (args: string[]) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		const hash = git(['rev-parse', '--short', 'HEAD']);
		return git(['status', '--porcelain']) ? `${hash}-dirty` : hash;
	} catch {
		return 'unknown';
	}
})();

export default defineConfig(({ command, isPreview }) => {
	// Local `npm run dev` is the dev site unless APP_ENV says otherwise (APP_ENV=prod npm run dev). Builds and `preview` stay prod.
	if (command === 'serve' && !isPreview) process.env.APP_ENV ??= 'dev';
	return {
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
	};
});
