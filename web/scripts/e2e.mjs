// The end-to-end check: drives the built app in a headless Chromium whose
// microphone is a synthetic tone, against a running API with an empty data
// directory. It records, saves, waits for the analysis, edits labels,
// imports files, and triggers the failure paths on purpose (no worker, API
// unreachable during an upload, microphone refused, a file that is not
// audio, a failed analysis, clipping).
//
//   node web/scripts/e2e.mjs --base http://127.0.0.1:8437 --worker "puptrainer-worker"
//
// `--worker` is the command that runs the analysis worker; the script
// starts it itself, after it has seen the app without one. Needs
// `PLAYWRIGHT_CORE` (the playwright-core package directory) and
// `PLAYWRIGHT_BROWSERS_PATH`; docs/development.md has the Nix lines.
// Exits 1 when a check fails.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		base: { type: 'string', default: 'http://127.0.0.1:8437' },
		worker: { type: 'string' }
	}
});
if (!process.env.PLAYWRIGHT_CORE || !args.worker) {
	console.error('PLAYWRIGHT_CORE and --worker are required: see docs/development.md.');
	process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);

const RATE = 48000;
const TONE_HZ = 170;
const scratch = mkdtempSync(join(tmpdir(), 'puptrainer-e2e-'));

/** A 16-bit mono WAV file of a voice-like tone; `gain` above 1 clips it. */
function toneFile(name, { hz = TONE_HZ, seconds = 3, gain = 0.3 } = {}) {
	const frames = Math.round(seconds * RATE);
	const buffer = Buffer.alloc(44 + 2 * frames);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + 2 * frames, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(RATE, 24);
	buffer.writeUInt32LE(2 * RATE, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(2 * frames, 40);
	for (let i = 0; i < frames; i++) {
		let v = 0;
		for (let k = 1; k <= 10; k++) v += Math.sin((2 * Math.PI * k * hz * i) / RATE) / k;
		const sample = Math.max(-1, Math.min(1, (gain * v) / 1.85));
		buffer.writeInt16LE(Math.round(sample * 32767), 44 + 2 * i);
	}
	const path = join(scratch, name);
	writeFileSync(path, buffer);
	return path;
}

const failures = [];
function check(name, ok, detail = '') {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
	if (!ok) failures.push(name);
}

/** Polls `read` until `accept` likes its value; the last value either way. */
async function until(read, accept, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	let value;
	for (;;) {
		value = await read();
		if (accept(value) || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

const launch = (microphone) =>
	chromium.launch({
		args: [
			'--use-fake-device-for-media-stream',
			'--use-fake-ui-for-media-stream',
			`--use-file-for-fake-audio-capture=${microphone}`
		]
	});

const text = (page, selector) => page.locator(selector).first().innerText();
const count = (page, selector) => page.locator(selector).count();
const hz = (value) => Number.parseInt(value.replace(/\s/g, ''), 10);

/** Records for `seconds` on the record page and stops; leaves the review open. */
async function record(page, seconds) {
	await page.click('[data-testid=start]');
	await page.waitForSelector('[data-testid=stop]');
	await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

let worker = null;
function stopWorker() {
	if (worker?.pid) {
		try {
			process.kill(-worker.pid);
		} catch {
			// already gone
		}
	}
}
process.on('exit', stopWorker);

let browser = await launch(toneFile('voice.wav'));
try {
	const context = await browser.newContext({ baseURL: args.base, locale: 'en-GB' });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => {
		errors.push(String(e));
		console.log('page error:', String(e));
	});
	page.on('console', (message) => {
		if (message.type() === 'error') console.log('console error:', message.text());
	});

	// --- an empty app
	await page.goto('/');
	await page.waitForSelector('text=No takes yet');
	check('empty list offers to record', true);
	await page.goto('/record');
	await page.waitForSelector('text=Add a microphone setup first');
	check('recording asks for a microphone setup first', true);

	// --- a microphone setup
	await page.goto('/devices');
	await page.getByRole('button', { name: 'Add microphone' }).click();
	await page.getByLabel('Name').fill('E2E microphone');
	await page.getByLabel('Setup notes').fill('synthetic tone');
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForSelector('[data-testid=devices] li');
	check('device is listed', (await text(page, '[data-testid=devices]')).includes('E2E microphone'));
	await page.getByRole('button', { name: 'Add microphone' }).click();
	await page.getByLabel('Name').fill('E2E microphone');
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForSelector('[role=alert]');
	check('duplicate device name is refused', (await text(page, '[role=alert]')).includes('exists'));

	// --- record a passage
	await page.goto('/record');
	await page.selectOption('[data-testid=what]', 'baseline:passage-en');
	check(
		'the passage is shown',
		(await text(page, '[data-testid=passage]')).startsWith('Every evening, a warm wind')
	);
	await record(page, 2.5);
	const live = await until(
		() => text(page, '[data-testid=live-pitch]'),
		(v) => Math.abs(hz(v) - TONE_HZ) <= 5,
		5_000
	);
	check('live pitch follows the tone', Math.abs(hz(live) - TONE_HZ) <= 5, live);
	check('the timer runs', (await text(page, '[data-testid=elapsed]')) >= '0:02');
	check(
		'no clipping warning for a normal level',
		(await count(page, '[data-testid=clip-warning]')) === 0
	);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=review]');
	const review = await text(page, '[data-testid=review]');
	check(
		'review shows length, peak and rate',
		/0:0[23] · peak −\d+\.\d dBFS · \d+(\.\d+)? kHz/.test(review),
		review
	);
	await page.click('[data-testid=save]');
	await page.waitForSelector('[data-testid=outcome]');
	check('take is saved', (await text(page, '[data-testid=outcome]')).startsWith('Saved'));

	// --- the baseline strip ticks the step off
	await page.goto('/record');
	await page.waitForSelector('[data-step=passage-en][data-done=true]');
	check('baseline step is ticked off after recording', true);
	check(
		'other baseline steps stay open',
		(await page.getAttribute('[data-step=passage-cs]', 'data-done')) === 'false'
	);

	// --- no worker yet: the take waits, the app says so
	await page.goto('/');
	await page.waitForSelector('[data-testid=takes] [data-status=pending]');
	check('take waits for analysis', true);
	await page.waitForSelector('[data-testid=worker-down]', { timeout: 15_000 });
	check('missing worker is announced', true);

	// --- the worker arrives
	worker = spawn(args.worker, {
		shell: true,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, PUPTRAINER_API_URL: args.base, PUPTRAINER_POLL_INTERVAL_S: '0.5' }
	});
	await page.waitForSelector('[data-testid=takes] [data-status=done]', { timeout: 60_000 });
	const row = await text(page, '[data-testid=takes] tbody tr');
	check('analysed take shows its pitch', /1[67]\d\sHz/.test(row), row.replace(/\s+/g, ' '));
	const banner = await until(
		() => count(page, '[data-testid=worker-down]'),
		(n) => n === 0,
		15_000
	);
	check('worker banner clears', banner === 0);

	// --- the take's page
	await page.click('[data-testid=takes] tbody tr a');
	await page.waitForSelector('[data-metric=pitch_median_hz]');
	const stored = hz(await text(page, '[data-metric=pitch_median_hz]'));
	check('stored pitch matches the tone', Math.abs(stored - TONE_HZ) <= 2, `${stored} Hz`);
	const peak = Number.parseFloat((await text(page, '[data-metric=peak_dbfs]')).replace('−', '-'));
	check('stored peak is the tone’s level', Math.abs(peak - -10.5) < 3, `${peak} dBFS`);
	const groups = await page
		.locator('[data-testid=metrics] section')
		.evaluateAll((sections) => sections.map((section) => section.dataset.group));
	check(
		'measurements are grouped',
		groups.includes('recording') && groups.includes('pitch'),
		groups.join(', ')
	);
	check(
		'speech takes carry the pitch distribution',
		(await count(page, '[data-metric=pitch_range_st]')) === 1 &&
			(await count(page, '[data-metric=pitch_145_185_pct]')) === 1
	);
	// NOTE: attached, not visible: a steady tone draws a flat line, which has no height
	await page.waitForSelector('[data-testid=contour] svg path.lc-path', { state: 'attached' });
	check('the pitch contour is drawn', true);
	const src = await page.locator('audio').getAttribute('src');
	const audio = await context.request.get(src);
	check(
		'recording is served as FLAC',
		audio.status() === 200 && audio.headers()['content-type'] === 'audio/flac'
	);
	const takeUrl = page.url();

	await page.selectOption('#labels-intent', 'attempt');
	await page.getByLabel('Note').fill('edited in the e2e run');
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForSelector('text=Saved');
	await page.reload();
	await page.waitForSelector('#labels-intent');
	check('edited labels persist', (await page.inputValue('#labels-intent')) === 'attempt');
	check(
		'edited note persists',
		(await page.getByLabel('Note').inputValue()) === 'edited in the e2e run'
	);

	// --- a failed analysis is shown with its reason and a retry
	const takeApi = `**/api/v1/takes/${takeUrl.split('/').pop()}`;
	await page.route(takeApi, async (route) => {
		const response = await route.fetch();
		const take = await response.json();
		take.analysis = {
			status: 'failed',
			pipeline_version: '0.1.0',
			error: 'PraatError: broken file',
			finished_at: null
		};
		take.metrics = {};
		await route.fulfill({ response, json: take });
	});
	await page.reload();
	await page.waitForSelector('[data-testid=analysis-error]');
	check(
		'failed analysis shows its reason',
		(await text(page, '[data-testid=analysis-error]')).includes('broken file')
	);
	check(
		'failed analysis offers a retry',
		await page.getByRole('button', { name: 'Retry' }).isVisible()
	);
	await page.unroute(takeApi);

	// --- progress: one chart per measurement of the kind of take
	await page.goto('/progress');
	await page.waitForSelector('[data-testid=trends] [data-testid=trend] svg circle');
	const trends = await text(page, '[data-testid=trends]');
	check('progress charts the pitch of the take', trends.includes('Median pitch'));
	check('progress leaves recording quality out', !trends.includes('Noise floor'));

	// --- the theme
	await page.goto('/');
	await page.click('[data-testid=theme] [data-mode=dark]');
	check(
		'dark theme applies',
		await page.evaluate(() => document.documentElement.classList.contains('dark'))
	);
	await page.reload();
	await page.waitForSelector('[data-testid=theme]');
	check(
		'theme choice persists across a reload',
		await page.evaluate(() => document.documentElement.classList.contains('dark'))
	);
	await page.click('[data-testid=theme] [data-mode=light]');
	check(
		'light theme applies',
		await page.evaluate(() => !document.documentElement.classList.contains('dark'))
	);

	// --- Czech
	await page.goto('/');
	await page.selectOption('[data-testid=locale]', 'cs');
	check('interface switches to Czech', (await text(page, 'nav a')) === 'Nahrávky');
	await page.reload();
	await page.waitForSelector('nav a');
	check('language choice persists', (await text(page, 'nav a')) === 'Nahrávky');
	check('page language follows', (await page.getAttribute('html', 'lang')) === 'cs');
	await page.selectOption('[data-testid=locale]', 'en');

	// --- the API goes away during an upload: the take stays on the device
	const uploads = '**/api/v1/takes';
	await page.route(uploads, (route) =>
		route.request().method() === 'POST' ? route.abort() : route.continue()
	);
	await page.goto('/record');
	await page.selectOption('[data-testid=what]', 'item:free');
	await record(page, 1.5);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=review]');
	await page.click('[data-testid=save]');
	await page.waitForSelector('[data-testid=outcome]');
	check(
		'unreachable API keeps the take locally',
		(await text(page, '[data-testid=outcome]')).startsWith('Kept on this device')
	);
	check(
		'waiting take is listed',
		(await text(page, '[data-testid=queue]')).includes('1 take waiting')
	);
	await page.unroute(uploads);
	// NOTE: leaving the page while the retry is in flight must not store the take twice
	await page.reload();
	await page.goto('/');
	await page.waitForSelector('[data-testid=takes]');
	const left = await until(
		() => count(page, '[data-testid=queue]'),
		(n) => n === 0,
		20_000
	);
	check('waiting take uploads once the API is back', left === 0);
	await page.reload();
	await page.waitForSelector('[data-testid=takes]');
	const two = await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 2,
		10_000
	);
	check('both takes are stored', two === 2, `${two} rows`);

	// --- import with labels from the file names, and a file that is not audio
	const files = [
		toneFile('2026-11-01_vowels_habitual.wav', { hz: 200, seconds: 2 }),
		toneFile('2026-11-02_free-cs_attempt.wav', { hz: 150, seconds: 2 })
	];
	const junk = join(scratch, '2026-11-03_other_habitual.wav');
	writeFileSync(junk, 'these are notes, not a recording');
	await page.goto('/import');
	await page.waitForSelector('[data-testid=files]');
	await page.setInputFiles('[data-testid=files]', [...files, junk]);
	await page.waitForSelector('[data-testid=import-rows]');
	check(
		'labels are read off the names',
		(await page.inputValue('#row-0-item')) === 'vowels' &&
			(await page.inputValue('#row-1-item')) === 'free' &&
			(await page.inputValue('#row-1-language')) === 'cs' &&
			(await page.inputValue('#row-1-intent')) === 'attempt'
	);
	await page.click('[data-testid=import-all]');
	await page.waitForSelector('[data-testid=queue]');
	const queued = await until(
		() => text(page, '[data-testid=queue]'),
		(v) => v.includes('1 take waiting') && v.includes('Rejected'),
		20_000
	);
	check(
		'a file that is not audio is refused with the reason',
		queued.includes('Rejected by the API') && queued.includes('not a readable audio file'),
		queued.replace(/\s+/g, ' ')
	);
	await page.locator('[data-testid=queue]').getByRole('button', { name: 'Discard' }).click();
	check(
		'refused file can be discarded',
		(await until(
			() => count(page, '[data-testid=queue]'),
			(n) => n === 0,
			5_000
		)) === 0
	);
	await page.goto('/');
	const four = await until(
		() => count(page, '[data-testid=takes] [data-status=done]'),
		(n) => n === 4,
		60_000
	);
	check('imported takes are analysed', four === 4, `${four} done`);
	await page.selectOption('select[aria-label=Language]:not([data-testid=locale])', 'cs');
	const czech = await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 1,
		5_000
	);
	check('the language filter narrows the list', czech === 1, `${czech} rows`);
	const imported = await text(page, '[data-testid=takes] tbody tr');
	check(
		'imported take keeps its labels, date and pitch',
		imported.includes('Free speech') &&
			imported.includes('Attempt') &&
			imported.includes('2 Nov 2026') &&
			/1[45]\d\sHz/.test(imported),
		imported.replace(/\s+/g, ' ')
	);

	// --- two takes side by side
	await page.selectOption('select[aria-label=Language]:not([data-testid=locale])', '');
	await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 4,
		5_000
	);
	check('compare needs two takes', await page.locator('[data-testid=compare]').isDisabled());
	const boxes = page.locator('[data-testid=takes] tbody input[type=checkbox]');
	await boxes.nth(0).check();
	await boxes.nth(1).check();
	await page.click('[data-testid=compare]');
	await page.waitForSelector('[data-testid=comparison] [data-metric=duration_s]');
	const difference = await text(page, '[data-testid=comparison] [data-metric=duration_s]');
	check(
		'comparison shows both values and the difference',
		/\d s .*\d s .*[+−±]\d/.test(difference.replace(/\s+/g, ' ')),
		difference.replace(/\s+/g, ' ')
	);
	check('comparison has both players', (await count(page, 'audio')) === 2);

	// --- an older pipeline's takes can be analysed again in one go
	await page.route('**/api/v1/health', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			json: { ...(await response.json()), pipeline_version: '9.9.9' }
		});
	});
	await page.goto('/');
	await page.waitForSelector('[data-testid=outdated]', { timeout: 15_000 });
	check(
		'takes of another pipeline version are announced',
		(await text(page, '[data-testid=outdated]')).includes('4 takes')
	);
	const requeue = page.waitForResponse((r) => r.url().includes('/analysis/requeue'));
	await page.locator('[data-testid=outdated]').getByRole('button').click();
	check('they are queued again', (await (await requeue).json()).queued === 4);
	await page.unroute('**/api/v1/health');
	const again = await until(
		() => count(page, '[data-testid=takes] [data-status=done]'),
		(n) => n === 4,
		60_000
	);
	check('and analysed again', again === 4, `${again} done`);

	// --- the installed app
	check(
		'service worker is registered',
		await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))
	);
	check('manifest is served', (await context.request.get('/manifest.webmanifest')).ok());

	// --- the microphone is refused
	const refused = await context.newPage();
	await refused.addInitScript(() => {
		navigator.mediaDevices.getUserMedia = () =>
			Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
	});
	await refused.goto('/record');
	await refused.click('[data-testid=start]');
	await refused.waitForSelector('[role=alert]');
	check(
		'refused microphone is explained',
		(await text(refused, '[role=alert]')).includes('refused the microphone')
	);
	check(
		'no recording starts without a microphone',
		(await count(refused, '[data-testid=stop]')) === 0
	);

	check('no uncaught errors in the page', errors.length === 0, errors.join(' | '));
	await browser.close();

	// --- a microphone that clips
	browser = await launch(toneFile('loud.wav', { gain: 4 }));
	const loud = await (await browser.newContext({ baseURL: args.base, locale: 'en-GB' })).newPage();
	await loud.goto('/record');
	await loud.waitForSelector('[data-testid=start]');
	await record(loud, 1.5);
	check(
		'clipping is flagged while recording',
		await loud.locator('[data-testid=clip-warning]').isVisible()
	);
	await loud.click('[data-testid=stop]');
	await loud.waitForSelector('[data-testid=review]');
	check('clipping is flagged before saving', await loud.getByText('clipped samples').isVisible());
} catch (e) {
	check('the run completes', false, e instanceof Error ? e.message.split('\n')[0] : String(e));
	// what the page looked like when the run stopped
	for (const context of browser.contexts()) {
		for (const open of context.pages()) {
			const state = await open
				.evaluate(() => ({
					url: location.pathname + location.search,
					size: [innerWidth, innerHeight],
					text: document.querySelector('main')?.innerText.replace(/\s+/g, ' ').slice(0, 400)
				}))
				.catch((error) => ({ error: String(error) }));
			console.log('page:', JSON.stringify(state));
		}
	}
} finally {
	await browser.close();
	stopWorker();
}

console.log(
	failures.length ? `\n${failures.length} failed: ${failures.join('; ')}` : '\nall checks passed'
);
process.exit(failures.length ? 1 : 0);
