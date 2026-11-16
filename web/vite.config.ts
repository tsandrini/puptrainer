import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** The API `npm run dev` proxies to. */
const api = process.env.PUPTRAINER_API_URL ?? 'http://127.0.0.1:8437';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// NOTE: a single-page app: the API serves index.html for every route
			adapter: adapter({ fallback: 'index.html', strict: false }),
			// NOTE: the app registers the worker itself, on the built origin only
			serviceWorker: { register: false }
		})
	],
	server: {
		proxy: {
			'/api': { target: api, changeOrigin: false }
		}
	}
});
