// The end-to-end check: drives the built app in a headless Chromium whose
// microphone is a synthetic tone, against a running API with an empty data
// directory. It records, saves, waits for the analysis, edits labels,
// imports files, runs guided practice sessions, and triggers the failure
// paths on purpose (no worker, API unreachable during an upload and during
// a session, microphone refused, a file that is not audio, a failed
// analysis, clipping, a strained rep, a hoarse check-in).
//
//   node web/scripts/e2e.mjs --base http://127.0.0.1:8437 --worker "puptrainer-worker" \
//     [--locked http://127.0.0.1:8438 --token SECRET]
//
// `--worker` is the command that runs the analysis worker; the script
// starts it itself, after it has seen the app without one. `--locked` is a
// second API that asks for `--token`, for the sign-in checks. Needs
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
		worker: { type: 'string' },
		locked: { type: 'string' },
		token: { type: 'string' }
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

/** How many different colours a canvas shows: 1 for a blank one. */
const colours = (page, selector) =>
	page
		.locator(selector)
		.first()
		.evaluate((canvas) => {
			const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
			const seen = new Set();
			for (let i = 0; i < data.length; i += 4)
				seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
			return seen.size;
		});
/** Where a player's playhead is, in seconds. */
const playerSeconds = async (page) =>
	Number(await page.locator('[data-testid=player-time]').first().getAttribute('data-seconds'));
const count = (page, selector) => page.locator(selector).count();
const hz = (value) => Number.parseInt(value.replace(/\s/g, ''), 10);

/** Records for `seconds` on the record page and stops; leaves the review open. */
async function record(page, seconds) {
	await page.click('[data-testid=start]');
	await page.waitForSelector('[data-testid=stop]');
	await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

let worker = null;
function startWorker() {
	worker = spawn(args.worker, {
		shell: true,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, PUPTRAINER_API_URL: args.base, PUPTRAINER_POLL_INTERVAL_S: '0.5' }
	});
}
function stopWorker() {
	if (worker?.pid) {
		try {
			process.kill(-worker.pid);
		} catch {
			// already gone
		}
	}
	worker = null;
}
process.on('exit', stopWorker);

const pause = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Records one rep in a practice session and stops; leaves the comfort question open. */
async function practiseRep(page, seconds) {
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=stop]');
	await pause(seconds);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=rating]');
}

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
	const scope = await until(
		() => colours(page, '[data-testid=live-scope] canvas'),
		(n) => n > 20,
		5_000
	);
	check('a live spectrogram follows the microphone', scope > 20, `${scope} colours`);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=review]');
	await page.waitForSelector('[data-testid=player][data-ready=true]');
	check(
		'the review has the player with the take drawn',
		(await colours(page, '[data-testid=player] canvas')) > 20
	);
	check(
		'the review does not play by itself',
		(await page.getAttribute('[data-testid=player-toggle]', 'data-playing')) === 'false' &&
			(await playerSeconds(page)) === 0
	);
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
	startWorker();
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
	await page.waitForSelector('[data-testid=player-download]');
	const src = await page.getAttribute('[data-testid=player-download]', 'href');
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

	// --- the player: the whole take drawn, play, seek, the two views
	await page.waitForSelector('[data-testid=player][data-ready=true]');
	check(
		'the player draws the stored take',
		(await colours(page, '[data-testid=player] canvas')) > 20
	);
	await page.click('[data-testid=player-toggle]');
	const moved = await until(
		() => playerSeconds(page),
		(s) => s > 0.3,
		10_000
	);
	check('playing moves the playhead', moved > 0.3, `${moved} s`);
	await page.click('[data-testid=player-toggle]');
	// NOTE: the element reports its pause a moment after the click
	await page.waitForSelector('[data-testid=player-toggle][data-playing=false]');
	const stopped = await playerSeconds(page);
	await pause(0.4);
	check('pausing stops it', (await playerSeconds(page)) === stopped);
	const plot = await page.locator('[data-testid=player-plot]').boundingBox();
	await page.mouse.click(plot.x + plot.width * 0.75, plot.y + plot.height / 2);
	const sought = await playerSeconds(page);
	check('a click seeks', Math.abs(sought - 0.75 * 2.6) < 0.4, `${sought} s`);
	await page.locator('[data-testid=player-plot]').press('Home');
	check('the keyboard seeks too', (await playerSeconds(page)) === 0);
	await page.click('[data-testid=spectrum-toggle] [data-view=formants]');
	await page.waitForSelector('[data-testid=player][data-ready=true]');
	check(
		'the formants view is drawn and remembered',
		(await colours(page, '[data-testid=player] canvas')) > 20 &&
			(await page.evaluate(() => localStorage.getItem('puptrainer.spectrum'))) === 'formants'
	);
	await page.click('[data-testid=spectrum-toggle] [data-view=harmonics]');
	check(
		'the recording can be downloaded',
		((await page.getAttribute('[data-testid=player-download]', 'href')) ?? '').endsWith('/audio')
	);

	// --- a recording missing from storage is said, not a broken player
	const audioApi = '**/api/v1/takes/*/audio';
	await page.route(audioApi, (route) =>
		route.fulfill({ status: 404, json: { error: 'the recording is missing from storage' } })
	);
	await page.reload();
	await page.waitForSelector('[data-testid=player][data-problem=missing]');
	check(
		'a missing recording is explained',
		(await text(page, '[data-testid=player] [role=alert]')).includes('missing from storage') &&
			(await count(page, '[data-testid=player-plot]')) === 0
	);
	await page.unroute(audioApi);
	await page.reload();
	await page.waitForSelector('[data-metric=pitch_median_hz]');

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
	await page.waitForFunction(
		() => document.querySelectorAll('[data-testid=player][data-ready=true]').length === 2
	);
	const toggles = page.locator('[data-testid=player-toggle]');
	await toggles.nth(0).click();
	await page.waitForSelector('[data-testid=player-toggle][data-playing=true]');
	await toggles.nth(1).click();
	const sounding = await until(
		() => toggles.evaluateAll((buttons) => buttons.map((button) => button.dataset.playing).join()),
		(v) => v === 'false,true',
		5_000
	);
	check('only one player sounds at a time', sounding === 'false,true', sounding);
	await toggles.nth(1).click();

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

	// --- practice: a band first
	await page.goto('/practice');
	await page.waitForSelector('[data-testid=band-card]');
	check('sessions wait for a band', (await count(page, '[data-testid=start-quick]')) === 0);
	await page.fill('[data-testid=band-low]', '200');
	await page.fill('[data-testid=band-high]', '190');
	await page.click('[data-testid=band-set]');
	await page.waitForSelector('[data-testid=band-card] [role=alert]');
	check('a band upside down is refused', true);
	await page.fill('[data-testid=band-low]', '160');
	await page.fill('[data-testid=band-high]', '200');
	await page.click('[data-testid=band-set]');
	await page.waitForSelector('[data-testid=start-quick]');
	check('the band is set', (await text(page, '[data-testid=band]')).includes('160 Hz'));
	check(
		'the catalogue lists the exercises with sources',
		(await count(page, '[data-testid=catalogue] [data-exercise]')) >= 8 &&
			// NOTE: textContent, the sources sit inside closed <details>
			((await page.locator('[data-testid=catalogue]').textContent()) ?? '').includes(
				'Sumian Voice wiki'
			)
	);

	// --- practice: the quick routine from start to end
	await page.click('[data-testid=start-quick]');
	await page.waitForSelector('[data-testid=checkin]');
	await page.click('[data-testid=feel-fresh]');
	await page.waitForSelector('[data-testid=step][data-exercise=slide-down-hold]');
	check(
		'a step says what to do, in steps, and can play its shape',
		(await count(page, '[data-testid=steps] li')) >= 3 &&
			(await count(page, '[data-testid=play-demo]')) === 1
	);
	check(
		'the session walks its steps',
		(await text(page, '[data-testid=position]')).includes('Exercise 1 of 2')
	);
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=band-strip]');
	check('a live band strip guides the slide', true);
	check(
		'pitch steps show no live spectrogram',
		(await count(page, '[data-testid=live-scope]')) === 0
	);
	await pause(2.5);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=rating]');
	check(
		'comfort is asked before any number',
		(await count(page, '[data-testid=evaluation]')) === 0
	);
	check('playback is never automatic', (await count(page, 'audio')) === 0);
	await page.click('[data-testid=listen]');
	check('playback is there when asked for', (await count(page, 'audio')) === 1);
	await page.waitForSelector('[data-testid=player][data-ready=true]');
	check(
		'and still waits to be started',
		(await page.getAttribute('[data-testid=player-toggle]', 'data-playing')) === 'false'
	);
	await page.click('[data-testid=comfort-4]');
	await page.waitForSelector('[data-testid=verdict]', { timeout: 30_000 });
	check('a steady hold in the band is met', (await text(page, '[data-testid=verdict]')) === 'Met');
	check(
		'the result shows the hold and the band',
		(await text(page, '[data-testid=result]')).includes('Steady hold')
	);

	await page.click('[data-testid=next]');
	await practiseRep(page, 2);
	await page.click('[data-testid=comfort-1]');
	await page.waitForSelector('[data-testid=strained]');
	check('a strained rep offers to stop', true);
	await page.getByRole('button', { name: 'Go to the next exercise' }).click();
	await page.waitForSelector('[data-testid=step][data-exercise=count-in-band]');

	// the worker goes away: the result is measured later
	stopWorker();
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=stop]');
	const strip = await until(
		() => text(page, '[data-testid=strip-pitch]'),
		(v) => Math.abs(hz(v.replace('You: ', '')) - TONE_HZ) <= 5,
		5_000
	);
	check('speech steps show the live pitch against the band', strip.includes('Hz'), strip);
	await pause(1.5);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=rating]');
	await page.click('[data-testid=comfort-5]');
	await page.waitForSelector('[data-testid=measuring]');
	check('without a worker the result waits', true);
	await page.click('[data-testid=next]');
	await page.waitForSelector('[data-testid=checkout]');
	await page.click('[data-testid=checkout] [data-testid=comfort-4]');
	await page.click('[data-testid=tension-no]');
	await page.click('[data-testid=finish]');
	await page.waitForSelector('[data-testid=done]');
	check('the session is saved', (await text(page, '[data-testid=summary]')).startsWith('Takes: 3'));
	startWorker();
	await page.getByRole('link', { name: 'Open it in the log' }).click();
	await page.waitForSelector('[data-testid=session-takes]');
	check(
		'the log has the session with its takes',
		(await count(page, '[data-testid=session-takes] > li')) === 3 &&
			(await text(page, '[data-testid=comfort-end]')).includes('Comfortable')
	);

	const later = await until(
		async () => {
			await page.reload();
			await page.waitForSelector('[data-testid=session-takes]');
			return count(page, '[data-testid=session-takes] [data-testid=verdict]');
		},
		(n) => n === 3,
		60_000
	);
	check('the waiting result arrives once the worker is back', later === 3, `${later} judged`);
	check(
		'a strained rep does not count as met',
		(await count(page, '[data-testid=strained-result]')) === 1
	);

	// --- practice: the API goes away during a session; nothing is lost
	const practiceApi = /\/api\/v1\/(practice\/|takes$)/;
	await page.route(practiceApi, (route) =>
		['PUT', 'POST'].includes(route.request().method()) ? route.abort() : route.continue()
	);
	await page.goto('/practice/run?exercise=count-in-band');
	await page.waitForSelector('[data-testid=checkin]');
	await page.selectOption('[data-testid=session-language]', 'cs');
	await page.getByRole('button', { name: 'Skip' }).click();
	await practiseRep(page, 2);
	await page.click('[data-testid=comfort-3]');
	await page.waitForSelector('[data-testid=result-offline]');
	check('an unreachable API keeps the practice take', true);
	await page.click('[data-testid=next]');
	await page.click('[data-testid=finish]');
	await page.waitForSelector('[data-testid=done]');
	check(
		'the session waits on the device too',
		(await text(page, '[data-testid=queue]')).includes('1 take waiting')
	);
	await page.unroute(practiceApi);
	const drained = await until(
		() => count(page, '[data-testid=queue]'),
		(n) => n === 0,
		30_000
	);
	check('session and take upload once the API is back', drained === 0);
	const sessions = await (await context.request.get('/api/v1/practice')).json();
	const offline = sessions.find((s) => s.language === 'cs');
	check(
		'the session arrived whole, before its take',
		offline?.take_count === 1 && offline?.ended_at !== null && offline?.routine_ref === null,
		JSON.stringify(offline)
	);

	// --- practice: a hoarse voice is told to rest
	await page.goto('/practice/run?routine=quick');
	await page.click('[data-testid=feel-hoarse]');
	await page.waitForSelector('[data-testid=rest]');
	await page.click('[data-testid=rest]');
	await page.waitForSelector('[data-testid=done]');
	check('resting needs no recording', (await count(page, '[data-testid=summary]')) === 0);
	const rested = await until(
		async () => (await (await context.request.get('/api/v1/practice')).json()).length,
		(n) => n === 3,
		20_000
	);
	const latest = (await (await context.request.get('/api/v1/practice')).json())[0];
	check(
		'the rest day is in the log',
		rested === 3 && latest.feel_start === 'hoarse' && latest.take_count === 0,
		JSON.stringify(latest)
	);

	// --- practice: the band can follow the learner's own voice
	await page.goto('/practice');
	await page.waitForSelector('[data-testid=band-own]');
	check(
		'a band is suggested from the everyday voice',
		/Use a band from your own voice: 1[78]\d–2[012]\d Hz/.test(
			await text(page, '[data-testid=band-own]')
		),
		await text(page, '[data-testid=band-own]')
	);
	check('the size routine is offered', (await count(page, '[data-testid=start-size]')) === 1);

	// --- practice: size is read against the everyday voice, with a live picture
	await page.goto('/practice/run?exercise=bright-phrase');
	await page.getByRole('button', { name: 'Skip' }).click();
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=live-scope]');
	check(
		'a size step shows the formants live with the pitch strip, without the switch',
		(await count(page, '[data-testid=live-scope] [data-testid=spectrum-toggle]')) === 0 &&
			(await count(page, '[data-testid=band-strip]')) === 1
	);
	await pause(2);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=rating]');
	await page.click('[data-testid=comfort-4]');
	await page.waitForSelector('[data-testid=result] [data-hint=vtl_cm]', { timeout: 30_000 });
	const size = await text(page, '[data-testid=result] [data-hint=vtl_cm]');
	check(
		'its size is shown beside the everyday voice, unjudged',
		/cm \(hint; your everyday voice: \d+\.\d cm\)/.test(size) &&
			(await count(page, '[data-testid=verdict]')) === 0,
		size.replace(/\s+/g, ' ')
	);

	// --- practice: a miss says which way to go; a band far above the voice is flagged
	await context.request.post('/api/v1/bands', { data: { low_hz: 200, high_hz: 240 } });
	await page.goto('/practice');
	await page.waitForSelector('[data-testid=band-reach]');
	check('a band well above the everyday voice is pointed out', true);
	await page.goto('/practice/run?exercise=count-in-band');
	await page.getByRole('button', { name: 'Skip' }).click();
	await practiseRep(page, 2);
	await page.click('[data-testid=comfort-3]');
	await page.waitForSelector('[data-testid=advice]', { timeout: 30_000 });
	check(
		'a miss comes with what to try next',
		(await text(page, '[data-testid=verdict]')) === 'Not yet' &&
			(await text(page, '[data-testid=advice]')).startsWith('You were below your band')
	);
	await context.request.post('/api/v1/bands', { data: { low_hz: 160, high_hz: 200 } });

	// --- practice takes stay out of the voice's progress
	await page.goto('/progress');
	await page.waitForSelector('[data-testid=kind]');
	const kinds = await text(page, '[data-testid=kind]');
	check('drills draw no progress line', !kinds.includes('Held sound'), kinds);
	await page.click('[data-testid=with-practice]');
	check(
		'practice attempts join when asked for',
		(await text(page, '[data-testid=kind]')).includes('Short phrase')
	);

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

	// --- an API that asks for its token
	if (args.locked && args.token) {
		const guarded = await (
			await browser.newContext({ baseURL: args.locked, locale: 'en-GB' })
		).newPage();
		await guarded.goto('/');
		await guarded.waitForSelector('[data-testid=login]');
		check(
			'a locked API shows the sign-in panel',
			(await count(guarded, '[data-testid=takes]')) === 0
		);
		await guarded.getByLabel('Access token').fill('not the token');
		await guarded.getByRole('button', { name: 'Sign in' }).click();
		await guarded.waitForSelector('[data-testid=login] [role=alert]');
		check(
			'a wrong token is refused',
			(await text(guarded, '[data-testid=login] [role=alert]')).includes('not accepted')
		);
		await guarded.getByLabel('Access token').fill(args.token);
		await guarded.getByRole('button', { name: 'Sign in' }).click();
		await guarded.waitForSelector('text=No takes yet');
		check('the right token opens the app', (await count(guarded, '[data-testid=login]')) === 0);
		await guarded.reload();
		await guarded.waitForSelector('text=No takes yet');
		check('the sign-in survives a reload', (await count(guarded, '[data-testid=login]')) === 0);
		await guarded.click('[data-testid=sign-out]');
		await guarded.waitForSelector('[data-testid=login]');
		check('signing out locks the app again', true);
		await guarded.close();
	}

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
