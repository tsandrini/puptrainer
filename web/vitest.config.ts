import { defineConfig } from 'vitest/config';

// NOTE: unit tests cover plain TypeScript modules only (audio, queue helpers),
// so they run without the SvelteKit plugin
export default defineConfig({
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
