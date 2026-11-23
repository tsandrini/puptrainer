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
/** What a help button says when it is opened; it is closed again. */
async function helpText(page, trigger) {
	await page.locator(trigger).first().click();
	const said = await text(page, '[data-testid=help-content]');
	await page.keyboard.press('Escape');
	await page.waitForSelector('[data-testid=help-content]', { state: 'detached' });
	return said;
}
/** The players of a page; the dock's own element is always there and is not one of them. */
const AUDIO = 'audio:not([data-testid=dock-audio])';
/** A chart's series as the chart library holds them (the instance sits on the chart's element). */
const chartSeries = (page, selector) =>
	page
		.locator(`${selector} [data-testid=chart]`)
		.first()
		.evaluate((element) =>
			element.chart.getOption().series.map((series) => ({
				id: series.id,
				dash: series.lineStyle?.type ?? null,
				zones: (series.markArea?.data ?? []).map((area) => area[0].name),
				bars: (series.markLine?.data ?? []).map((line) => line.label?.formatter ?? ''),
				takes: (series.data ?? []).map((datum) => datum?.take ?? datum?.takes ?? null)
			}))
		);
/** Where a chart draws the first point that is a take, in the chart's own pixels. */
const chartPoint = (page, selector) =>
	page
		.locator(`${selector} [data-testid=chart]`)
		.first()
		.evaluate((element) => {
			const option = element.chart.getOption();
			const index = option.series.findIndex((series) => series.data?.[0]?.take);
			const datum = option.series[index].data[0];
			const [x, y] = element.chart.convertToPixel({ seriesIndex: index }, datum.value);
			return { x, y, take: datum.take };
		});
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
	check(
		'every picture says what it shows of the two targets',
		(await helpText(page, '[data-testid=spectrum-toggle] + [data-testid=help]')).includes(
			'Pitch is their spacing'
		)
	);
	const rolling = await until(
		() => text(page, '[data-testid=live-traces] li[data-series=pitch_hz] [data-testid=plot-value]'),
		(v) => Math.abs(hz(v) - TONE_HZ) <= 5,
		10_000
	);
	check(
		'a live graph draws the last seconds, row by row',
		Math.abs(hz(rolling) - TONE_HZ) <= 5 &&
			(await page.getAttribute('[data-testid=live-traces] [data-testid=traces]', 'data-rows')) ===
				'pitch_hz brightness_pct lightness_db level_db',
		rolling
	);
	check(
		'speech gets no map of pitch against brightness, and is told why its brightness is slow',
		(await count(page, '[data-testid=live-map]')) === 0 &&
			(await helpText(page, '[data-testid=live-traces] [data-testid=help]')).includes(
				'the last eight seconds'
			)
	);
	const unanchored = await until(
		() => text(page, '[data-testid=live-status]'),
		(v) => v.includes('No everyday take'),
		5_000
	);
	check(
		'the live resonance says when there is no everyday take to count from',
		unanchored.includes('No everyday take') &&
			(await page.getAttribute('[data-testid=live-resonance]', 'data-from')) === 'everyday',
		unanchored
	);
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
	check(
		'the review draws the take as the live guide saw it, and says so',
		(await page.getAttribute('[data-testid=take-review] [data-testid=traces]', 'data-live')) ===
			'true' &&
			(await text(page, '[data-testid=take-review] [data-testid=traces-reads]')).includes(
				'live guide'
			)
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
	await page.waitForSelector('[data-testid=traces][data-live=false]');
	const traced = await page.getAttribute('[data-testid=traces]', 'data-rows');
	check(
		'the take is drawn moment by moment: pitch, the source and the level',
		['pitch_hz', 'lightness_db', 'clarity_db', 'level_db'].every((row) => traced.includes(row)) &&
			!traced.includes('brightness_pct'),
		traced
	);
	check(
		'and speech is told why it has no brightness row',
		(await text(page, '[data-testid=traces-speech]')).includes('follows the words')
	);
	await page.waitForSelector('[data-testid=player-download]');
	const src = await page.getAttribute('[data-testid=player-download]', 'href');
	const audio = await context.request.get(src);
	check(
		'recording is served as FLAC',
		audio.status() === 200 && audio.headers()['content-type'] === 'audio/flac'
	);
	const takeUrl = page.url();

	const reading = page.locator('[data-testid=reading]');
	check(
		'an everyday take is read against the everyday voice, and is it',
		(await reading.getAttribute('data-basis')) === 'same-text' &&
			(await reading.locator('[data-shift=pitch_shift_st]').innerText()).startsWith('0.0') &&
			(await reading.locator('[data-note=everyday]').count()) === 1,
		(await reading.innerText()).replace(/\s+/g, ' ').slice(0, 160)
	);
	check(
		'resonance sits on a strip with the zones it is read by',
		(await reading.locator('[data-testid=shift-strip] [data-testid=marker]').count()) === 1 &&
			(await reading.locator('[data-testid=shift-strip]').innerText()).includes('where women')
	);
	check(
		'every group and measurement says how it stands to the two targets',
		(await helpText(page, '[data-group=pitch] h2 [data-testid=help]')).includes(
			'The first target'
		) &&
			(await helpText(page, '[data-group=pitch] dt [data-testid=help]')).includes(
				'Pitch: the headline'
			) &&
			// NOTE: behind the buttons, not on the page
			!(await text(page, '[data-group=pitch]')).includes('The first target')
	);

	await page.selectOption('#labels-intent', 'attempt');
	await page.getByLabel('Note').fill('edited in the e2e run');
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForSelector('text=Saved');
	await page.reload();
	await page.waitForSelector('#labels-intent');
	check('edited labels persist', (await page.inputValue('#labels-intent')) === 'attempt');
	check(
		'an attempt with no everyday take says what is missing',
		(await count(page, '[data-testid=reading]')) === 0 &&
			(await text(page, '[data-testid=unread]')).includes('no everyday take')
	);
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
	// NOTE: a click through the locator: the rows may lie below the fold
	const rows = await page.locator('[data-testid=traces-plot]').boundingBox();
	await page
		.locator('[data-testid=traces-plot]')
		.click({ position: { x: rows.width * 0.5, y: 80 } });
	const jumped = await playerSeconds(page);
	check(
		'a click on the traces seeks the player',
		Math.abs(jumped - 0.5 * 2.6) < 0.4,
		`${jumped} s`
	);
	const there = await text(
		page,
		'[data-testid=traces] li[data-series=pitch_hz] [data-testid=plot-value]'
	);
	check('and each row says its value there', Math.abs(hz(there) - TONE_HZ) <= 3, there);
	await page.locator('[data-testid=player-plot]').press('Home');
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

	// --- progress: the takes as statistics, a tab at a time
	await page.goto('/progress');
	await page.click('[data-testid=tab-measures]');
	await page.waitForSelector('[data-testid=trends] [data-chart=pitch_median_hz] canvas');
	const trends = await text(page, '[data-testid=trends]');
	check('progress charts the pitch of the take', trends.includes('Median pitch'));
	check(
		'progress is laid out by target',
		(await count(page, '[data-testid=trends] [data-target=pitch]')) === 1 &&
			(await count(page, '[data-testid=trends] [data-target=condition]')) === 1
	);
	check('progress leaves recording quality out', !trends.includes('Noise floor'));
	check(
		'what a target and a measurement mean waits behind help buttons',
		!trends.includes('The first target') &&
			(await helpText(page, '[data-target=pitch] h2 [data-testid=help]')).includes(
				'The first target'
			) &&
			(await helpText(page, '[data-chart=pitch_median_hz] [data-testid=help]')).includes(
				'Pitch: the headline'
			)
	);
	check('only the open tab is drawn', (await count(page, '[data-chart=against-everyday]')) === 0);
	// a point is a take: the pointer names it, a click plays it, nothing plays by itself
	const pitchChart = page.locator('[data-chart=pitch_median_hz] [data-testid=chart]');
	const spot = await chartPoint(page, '[data-chart=pitch_median_hz]');
	await pitchChart.hover({ position: { x: spot.x, y: spot.y } });
	const named = await until(
		() => text(page, '[data-chart=pitch_median_hz] [data-testid=chart-tip]').catch(() => ''),
		(said) => said.includes('Click to listen'),
		5_000
	);
	check(
		'the pointer names the take under it',
		/Everyday voice|Attempt/.test(named),
		named.replace(/\s+/g, ' ')
	);
	await pause(0.6);
	check('nothing plays on hover', (await count(page, '[data-testid=dock]')) === 0);
	await pitchChart.click({ position: { x: spot.x, y: spot.y } });
	await page.waitForSelector('[data-testid=dock][data-playing=true]');
	check(
		'a click on a point plays its take in the dock',
		(await page.getAttribute('[data-testid=dock]', 'data-take')) === spot.take
	);
	await page.click('[data-testid=dock-close]');
	// every chart: over the whole screen, as a table, as a file
	await page.click('[data-chart=pitch_median_hz] [data-testid=chart-full]');
	await page.waitForSelector('[data-testid=chart-dialog] [data-testid=chart] canvas');
	check('a chart opens over the whole screen', true);
	await page.keyboard.press('Escape');
	await page.waitForSelector('[data-testid=chart-dialog]', { state: 'detached' });
	await page.click('[data-chart=pitch_median_hz] [data-testid=chart-more]');
	await page.click('[data-testid=chart-table-toggle]');
	await page.waitForSelector('[data-chart=pitch_median_hz] [data-testid=chart-table]');
	check(
		'a chart shows its numbers as a table',
		/1[67]\d/.test(await text(page, '[data-chart=pitch_median_hz] [data-testid=chart-table]'))
	);
	await page.click('[data-chart=pitch_median_hz] [data-testid=chart-more]');
	const [saved] = await Promise.all([
		page.waitForEvent('download'),
		page.click('[data-testid=chart-csv]')
	]);
	check(
		'and saves them as a file',
		/^puptrainer-pitch_median_hz-\d{4}-\d\d-\d\d\.csv$/.test(saved.suggestedFilename()),
		saved.suggestedFilename()
	);
	await page.click('[data-chart=pitch_median_hz] [data-testid=chart-more]');
	await page.click('[data-testid=chart-table-toggle]');
	// a stretch of time: quick ranges, and an exact one that holds nothing
	await page.click('[data-testid=date-range-open]');
	await page.click('[data-testid=date-range-panel] [data-quick="7"]');
	check(
		'a quick range keeps the recent take',
		(await page.getAttribute('[data-testid=date-range]', 'data-kind')) === 'quick' &&
			(await count(page, '[data-testid=trends] [data-testid=chart-card]')) > 0 &&
			new URL(page.url()).searchParams.get('range') === '7d'
	);
	await page.click('[data-testid=date-range-open]');
	await page.fill('[data-testid=date-range-from]', '2020-01-02T10:00');
	await page.fill('[data-testid=date-range-to]', '2020-01-01T10:00');
	await page.click('[data-testid=date-range-apply]');
	check(
		'a range that ends before it starts is refused, with the reason',
		(await text(page, '[data-testid=date-range-panel] [role=alert]')).includes('after the start')
	);
	await page.fill('[data-testid=date-range-to]', '2020-01-03T10:00');
	await page.click('[data-testid=date-range-apply]');
	await page.waitForSelector('[data-testid=date-range][data-kind=absolute]');
	check(
		'an exact range with nothing in it shows nothing',
		(await count(page, '[data-testid=trends]')) === 0 &&
			(await page.getByText('No analysed take matches').count()) === 1
	);
	// the view is the page's state: a reload and a return through the navigation find it
	await page.click('nav a[href="/practice"]');
	await page.waitForSelector('[data-testid=catalogue]');
	await page.click('nav a[href="/progress"]');
	await page.waitForSelector('[data-testid=date-range][data-kind=absolute]');
	check('coming back finds the range and the tab as they were', true);
	await page.click('[data-testid=view-reset]');
	await page.waitForSelector('[data-testid=panel-voice]');
	check(
		'a reset is the first tab over everything; a take with nothing to be read against says what to record',
		new URL(page.url()).search === '' &&
			(await text(page, '[data-testid=panel-voice]')).includes('record the same kind of take')
	);
	await page.click('[data-testid=tab-relations]');
	await page.waitForSelector('[data-testid=cross] [data-chart=scatter] canvas');
	check(
		'any two measures can be put against each other',
		(await count(page, '[data-testid=cross-x] option')) > 3 &&
			(await text(page, '[data-chart=scatter]')).includes('fewer than three')
	);
	await page.click('[data-testid=view-reset]');

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
	await page.click('[data-testid=filter-language]');
	await page.click('[data-option=cs]');
	await page.keyboard.press('Escape');
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

	// --- the table keeps its view: in the address, and across a visit to a take
	check('the view is in the address', new URL(page.url()).searchParams.get('lang') === 'cs');
	await page.click('[data-testid=takes] tbody tr a');
	await page.waitForSelector('[data-metric=pitch_median_hz]');
	check(
		'a take opened from a list of one has nowhere to step to',
		(await count(page, '[data-testid=trail]')) === 0
	);
	await page.click('nav a[href="/"]');
	await page.waitForSelector('[data-testid=takes] tbody tr a');
	check(
		'coming back from a take finds the filters as they were',
		(await page.getAttribute('[data-testid=filter-language]', 'data-chosen')) === 'cs' &&
			(await count(page, '[data-testid=takes] tbody tr')) === 1
	);
	await page.click('[data-testid=view-reset]');
	await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 4,
		5_000
	);
	// search folds case and accents and marks what it found
	await page.fill('[data-testid=table-search]', 'FREE cestina'.replace('cestina', 'czech'));
	const hits = await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 1,
		5_000
	);
	check(
		'search narrows the table and marks its words',
		hits === 1 && (await count(page, '[data-testid=takes] tbody mark')) >= 2,
		`${hits} rows`
	);
	await page.fill('[data-testid=table-search]', 'nothing like this');
	await page.waitForSelector('[data-testid=table-empty]');
	check(
		'a search without a match says so',
		(await text(page, '[data-testid=table-empty]')).includes('Nothing matches')
	);
	await page.fill('[data-testid=table-search]', '');
	await until(
		() => count(page, '[data-testid=takes] tbody tr'),
		(n) => n === 4,
		5_000
	);
	// a header sorts; the longest take comes first, then last
	await page.click('[data-sort=duration]');
	const [once, onceOrder] = [
		await text(page, '[data-testid=takes] tbody tr'),
		await page.getAttribute('[data-sort=duration]', 'data-order')
	];
	await page.click('[data-sort=duration]');
	const [twice, twiceOrder] = [
		await text(page, '[data-testid=takes] tbody tr'),
		await page.getAttribute('[data-sort=duration]', 'data-order')
	];
	check(
		'a click on a header sorts, another turns it round',
		once !== twice &&
			onceOrder !== twiceOrder &&
			[onceOrder, twiceOrder].sort().join() === 'asc,desc' &&
			new URL(page.url()).searchParams.get('sort')?.endsWith('duration') === true,
		`${onceOrder} / ${twiceOrder}`
	);
	await page.click('[data-testid=view-reset]');
	// a row's play button sends the take to the dock, with the table as its list
	check('nothing plays before it is asked for', (await count(page, '[data-testid=dock]')) === 0);
	await page.locator('[data-testid=row-play]').first().click();
	await page.waitForSelector('[data-testid=dock][data-playing=true]');
	check(
		'a row plays in the dock, which knows the table behind it',
		(await page.getAttribute('[data-testid=dock]', 'data-queue')) === '4' &&
			(await page.getAttribute('[data-testid=row-play]', 'data-playing')) === 'true'
	);
	const firstTake = await page.getAttribute('[data-testid=dock]', 'data-take');
	await page.click('[data-testid=dock-next]');
	await page.waitForFunction(
		(first) => document.querySelector('[data-testid=dock]')?.dataset.take !== first,
		firstTake
	);
	check(
		'next walks down the table',
		(await text(page, '[data-testid=dock-place]')).replace(/\s/g, '') === '2/4' &&
			(await page.locator('[data-testid=row-play]').nth(1).getAttribute('data-playing')) === 'true'
	);
	await page.click('nav a[href="/devices"]');
	await page.waitForSelector('[data-testid=dock][data-playing=true]');
	check('the dock goes on playing while other pages open', true);
	await page.keyboard.press('k');
	await page.waitForSelector('[data-testid=dock][data-playing=false]');
	check('K pauses it', true);
	await page.click('[data-testid=dock-close]');
	check('and it closes', (await count(page, '[data-testid=dock]')) === 0);
	await page.click('nav a[href="/"]');
	await page.waitForSelector('[data-testid=takes] tbody tr a');

	// a take's page steps through the table it was opened from
	await page.click('[data-testid=takes] tbody tr a');
	await page.waitForSelector('[data-testid=trail]');
	const here = page.url();
	check(
		'a take knows its place in the table',
		(await text(page, '[data-testid=trail-place]')).replace(/\s/g, '') === '1/4' &&
			(await page.locator('[data-testid=trail-previous]').getAttribute('href')) === null
	);
	await page.keyboard.press(']');
	await page.waitForFunction((from) => location.href !== from, here);
	await page.waitForSelector('[data-testid=trail-place]');
	check(
		'] steps to the next take of the table',
		(await text(page, '[data-testid=trail-place]')).replace(/\s/g, '') === '2/4'
	);
	await page.click('[data-testid=trail-previous]');
	await page.waitForURL(here);
	await page.click('nav a[href="/"]');
	await page.waitForSelector('[data-testid=takes] tbody tr a');

	// --- one box to get anywhere, and the list of keys
	const logoAt = async () => (await page.locator('header a').first().boundingBox()).x;
	const logoOnTakes = await logoAt();
	await page.keyboard.press('Control+k');
	await page.waitForSelector('[data-testid=palette-input]');
	await page.fill('[data-testid=palette-input]', 'PROGRESS relat');
	check(
		'the palette narrows as words are typed',
		(await count(page, '[data-testid=palette] [role=option]')) === 1
	);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/progress\?tab=relations/);
	await page.waitForSelector('[data-testid=palette]', { state: 'detached' });
	check('Enter goes there', true);
	await page.keyboard.press('Control+k');
	await page.fill('[data-testid=palette-input]', 'free czech');
	await page.waitForSelector('[data-testid=palette] [data-entry^="take:"]');
	await page.keyboard.press('Alt+Enter');
	await page.waitForSelector('[data-testid=dock][data-playing=true]');
	check('Alt+Enter on a take plays it without leaving the page', page.url().includes('/progress'));
	await page.click('[data-testid=dock-close]');
	await page.keyboard.press('?');
	await page.waitForSelector('[data-testid=keys]');
	check('? lists the keys', (await text(page, '[data-testid=keys]')).includes('Ctrl K'));
	await page.keyboard.press('Escape');
	await page.waitForSelector('[data-testid=keys]', { state: 'detached' });
	await page.click('[data-testid=view-reset]');
	// the shell is one width: nothing of it moves between a page of data and a page to read
	await page.click('nav a[href="/record"]');
	await page.waitForSelector('[data-testid=what]');
	const logoOnRecord = await logoAt();
	check(
		'the shell stays where it is from page to page',
		Math.abs(logoOnRecord - logoOnTakes) < 1,
		`${logoOnTakes} / ${logoOnRecord}`
	);
	await page.click('nav a[href="/"]');
	await page.waitForSelector('[data-testid=takes] tbody tr a');

	// --- two takes side by side
	const boxes = page.locator('[data-testid=takes] [data-testid=tick]');
	await boxes.nth(0).click();
	await page.waitForSelector('[data-testid=table-bulk]');
	check('compare needs two takes', await page.locator('[data-testid=compare]').isDisabled());
	await boxes.nth(1).click();
	await page.click('[data-testid=compare]');
	await page.waitForSelector('[data-testid=comparison] [data-metric=duration_s]');
	const difference = await text(page, '[data-testid=comparison] [data-metric=duration_s]');
	check(
		'comparison shows both values and the difference',
		/\d s .*\d s .*[+−±]\d/.test(difference.replace(/\s+/g, ' ')),
		difference.replace(/\s+/g, ' ')
	);
	check('comparison has both players', (await count(page, AUDIO)) === 2);
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
	// the two takes over each other, moment by moment; the other take at the same place
	await page.waitForSelector('[data-testid=compare-traces] [data-grid=pitch_hz] .uplot canvas');
	check(
		'the two takes are drawn over each other, a grid per measure, each with both values',
		(await page.getAttribute('[data-testid=compare-traces]', 'data-rows')).startsWith('pitch_hz') &&
			(await count(page, '[data-grid=pitch_hz] [data-testid=plot-legend] li')) === 2
	);
	await page.click('[data-testid=compare-align]');
	check(
		'the second take can be lined up with the first, and moved by hand',
		/^B [+−]?\d/.test(await text(page, '[data-testid=compare-shift]'))
	);
	const playheads = () =>
		page
			.locator('[data-testid=player-time]')
			.evaluateAll((times) => times.map((time) => Number(time.dataset.seconds)));
	const pitchGrid = page.locator('[data-grid=pitch_hz] .u-over');
	const gridBox = await pitchGrid.boundingBox();
	await pitchGrid.click({ position: { x: gridBox.width * 0.4, y: gridBox.height / 2 } });
	const [seekA, seekB] = await playheads();
	check(
		'a click on the graphs moves both takes to that moment',
		seekA > 0.3 && seekB > 0.3,
		`${seekA} / ${seekB}`
	);
	await page.keyboard.press('x');
	const went = await until(
		() => toggles.evaluateAll((buttons) => buttons.map((button) => button.dataset.playing).join()),
		(v) => v !== 'false,false',
		5_000
	);
	check(
		'X goes on in the other take',
		went.split(',').filter((v) => v === 'true').length === 1,
		went
	);
	await page.keyboard.press('x');
	const back = await until(
		() => toggles.evaluateAll((buttons) => buttons.map((button) => button.dataset.playing).join()),
		(v) => v !== went && v !== 'false,false',
		5_000
	);
	check(
		'and back again, one at a time',
		back !== went && back.includes('true'),
		`${went} → ${back}`
	);
	await page.locator('[data-testid=player-toggle][data-playing=true]').click();
	// one of the two without a graph: the page names it and still draws the other
	const graphApi = `**/api/v1/takes/${new URL(page.url()).searchParams.get('b')}/trace*`;
	await page.route(graphApi, (route) => route.fulfill({ status: 404, body: '{}' }));
	await page.reload();
	await page.waitForSelector('[data-testid=compare-no-graph]');
	check(
		'a take without a graph is named, and the other one is still drawn',
		(await text(page, '[data-testid=compare-no-graph]')).includes('Take B') &&
			(await count(page, '[data-grid=pitch_hz] [data-testid=plot-legend] li')) === 1
	);
	await page.unroute(graphApi);
	await page.goto('/compare?a=nope&b=neither');
	await page.waitForSelector('[data-testid=compare-failed]');
	check('takes that cannot be loaded are said to be so', true);

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
	check('sessions wait for a band', (await count(page, '[data-testid=start-pitch]')) === 0);
	await page.fill('[data-testid=band-low]', '200');
	await page.fill('[data-testid=band-high]', '190');
	await page.click('[data-testid=band-set]');
	await page.waitForSelector('[data-testid=band-card] [role=alert]');
	check('a band upside down is refused', true);
	await page.fill('[data-testid=band-low]', '160');
	await page.fill('[data-testid=band-high]', '200');
	await page.click('[data-testid=band-set]');
	await page.waitForSelector('[data-testid=start-pitch]');
	check('the band is set', (await text(page, '[data-testid=band]')).includes('160 Hz'));
	check(
		'the catalogue lists the exercises with sources',
		(await count(page, '[data-testid=catalogue] [data-exercise]')) >= 8 &&
			// NOTE: textContent, the sources sit inside closed <details>
			((await page.locator('[data-testid=catalogue]').textContent()) ?? '').includes(
				'Sumian Voice wiki'
			)
	);

	check(
		'two sessions are offered, one per target',
		(await count(page, '[data-testid=routines] [data-routine]')) === 2 &&
			(await count(page, '[data-testid=start-resonance]')) === 1
	);

	// --- practice: the pitch session from start to end (the warm-up and the hum skipped)
	await page.click('[data-testid=start-pitch]');
	await page.waitForSelector('[data-testid=checkin]');
	await page.click('[data-testid=feel-fresh]');
	for (const skipped of ['hum-glide', 'light-hum']) {
		await page.waitForSelector(`[data-testid=step][data-exercise=${skipped}]`);
		await page.click('[data-testid=skip-step]');
	}
	await page.waitForSelector('[data-testid=step][data-exercise=slide-down-hold]');
	check(
		'a step says what to do, in steps, and can play its shape',
		(await count(page, '[data-testid=steps] li')) >= 3 &&
			(await count(page, '[data-testid=play-demo]')) === 1
	);
	check(
		'the session walks its steps',
		(await text(page, '[data-testid=position]')).includes('Exercise 3 of 6')
	);
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=band-strip]');
	check('a live band strip guides the slide', true);
	await page.waitForSelector('[data-testid=live-traces] [data-testid=traces]');
	check(
		'and a live graph without resonance rows',
		(await page.getAttribute('[data-testid=live-traces] [data-testid=traces]', 'data-rows')) ===
			'pitch_hz lightness_db level_db'
	);
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
	check('playback is never automatic', (await count(page, AUDIO)) === 0);
	await page.click('[data-testid=listen]');
	check('playback is there when asked for', (await count(page, AUDIO)) === 1);
	await page.waitForSelector('[data-testid=player][data-ready=true]');
	check(
		'and still waits to be started',
		(await page.getAttribute('[data-testid=player-toggle]', 'data-playing')) === 'false'
	);
	await page.click('[data-testid=comfort-4]');
	await page.waitForSelector('[data-testid=verdict]', { timeout: 30_000 });
	check('a steady hold in the band is met', (await text(page, '[data-testid=verdict]')) === 'Met');
	await page.waitForSelector('[data-testid=result-traces] [data-testid=traces][data-live=false]');
	check(
		'the result draws the measured take under a player that waits',
		(
			await page.getAttribute('[data-testid=result-traces] [data-testid=traces]', 'data-rows')
		).includes('pitch_hz') &&
			(await page.getAttribute(
				'[data-testid=result-traces] [data-testid=player-toggle]',
				'data-playing'
			)) === 'false'
	);
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
	await page.waitForSelector('[data-testid=step][data-exercise=note-match]');
	await page.click('[data-testid=skip-step]');
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
	await page.waitForSelector('[data-testid=step][data-exercise=anchor-phrases]');
	await page.click('[data-testid=end]');
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
	await page.goto('/practice/run?routine=pitch');
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

	// --- the live resonance counts from the everyday takes, measured in the browser
	await page.goto('/record');
	await page.selectOption('[data-testid=what]', 'item:free');
	await record(page, 3.5);
	const counted = await until(
		() => text(page, '[data-testid=live-brightness]'),
		(v) => /[+−]?\d+ %/.test(v),
		20_000
	);
	const brightness = Number.parseInt(
		counted.replace('−', '-').replace(/[^-\d]*(-?\d+) %.*/s, '$1'),
		10
	);
	check(
		'the live resonance of the everyday voice reads about zero against itself',
		Math.abs(brightness) <= 3,
		counted.replace(/\s+/g, ' ')
	);
	check(
		'and says what it is counted from',
		(await text(page, '[data-testid=live-status]')).includes('this take so far')
	);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=review]');
	await page.getByRole('button', { name: 'Discard' }).click();
	check(
		'the texts of the exercises can be recorded in the everyday voice',
		(await text(page, '[data-testid=what]')).includes('Anchor phrases (English)')
	);
	check(
		'they have buttons of their own beside the baseline, none read yet',
		(await count(page, '[data-testid=texts] [data-text]')) === 2 &&
			(await page.getAttribute('[data-text=anchors-en]', 'data-taken')) === '0'
	);
	await page.click('[data-text=anchors-en]');
	check(
		'a button picks its text',
		(await page.inputValue('[data-testid=what]')) === 'text:anchors-en' &&
			(await text(page, '[data-testid=passage]')).startsWith('Hey, how')
	);
	await record(page, 2);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=review]');
	await page.click('[data-testid=save]');
	await page.waitForSelector('[data-testid=outcome]');
	const taken = await until(
		() => page.getAttribute('[data-text=anchors-en]', 'data-taken'),
		(v) => v === '1',
		15_000
	);
	check('a text read in the everyday voice is ticked', taken === '1', `${taken} takes`);

	// --- practice: a whisper is followed live, from its own start
	await page.goto('/practice/run?exercise=whisper-slide');
	await page.getByRole('button', { name: 'Skip' }).click();
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=live-resonance][data-mode=whisper]');
	check(
		'an exercise in several parts shows their order while recording',
		(await count(page, '[data-testid=sequence] li[data-pause=false]')) === 4 &&
			(await text(page, '[data-testid=sequence]')).includes('slide to small')
	);
	check(
		'a whisper step counts from the start of the take and waits for a whisper',
		(await page.getAttribute('[data-testid=live-resonance]', 'data-from')) === 'start' &&
			(await count(page, '[data-testid=band-strip]')) === 0 &&
			(await text(page, '[data-testid=live-status]')).includes('Setting the zero')
	);
	check(
		'and has its live graph, for a whisper',
		(await page.getAttribute('[data-testid=live-traces]', 'data-mode')) === 'whisper' &&
			(await count(page, '[data-testid=live-map]')) === 0
	);
	await page.getByRole('button', { name: 'Discard' }).click();

	// --- practice: the step between a whisper and a voice, and the small bright step
	await page.goto('/practice/run?exercise=voice-in');
	await page.getByRole('button', { name: 'Skip' }).click();
	check(
		'letting the voice into a whisper shows its order',
		(await count(page, '[data-testid=sequence] li[data-pause=false]')) === 5 &&
			(await text(page, '[data-testid=sequence]')).includes('quiet voice in')
	);
	await page.click('[data-testid=try]');
	await page.waitForSelector('[data-testid=live-traces][data-mode=whisper]');
	check(
		'and is followed as a whisper that a voice may come into',
		(await page.getAttribute('[data-testid=live-resonance]', 'data-mode')) === 'whisper'
	);
	await page.click('[data-testid=done-trying]');
	await page.goto('/practice/run?exercise=resonance-edge');
	await page.getByRole('button', { name: 'Skip' }).click();
	check(
		'the small bright step is an exercise of its own',
		(await text(page, '[data-testid=step]')).includes('Ordinary, dark, a little bright') &&
			(await text(page, '[data-testid=sequence]')).includes('A little bright · 3 s')
	);

	// --- practice: an exercise can be tried with its live guides, and nothing is kept
	const takesBefore = (await (await context.request.get('/api/v1/takes?limit=1000')).json()).length;
	await page.goto('/practice/run?exercise=resonance-contrast');
	await page.getByRole('button', { name: 'Skip' }).click();
	check(
		'the order of a take is drawn with its pauses',
		(await count(page, '[data-testid=sequence] li[data-pause=true]')) === 2 &&
			(await text(page, '[data-testid=sequence]')).includes('Ordinary “ah” · 3 s')
	);
	await page.click('[data-testid=try]');
	await page.waitForSelector('[data-testid=trying]');
	await page.waitForSelector('[data-testid=live-resonance][data-from=start]');
	const tried = await until(
		() => text(page, '[data-testid=live-brightness]'),
		(v) => /[+−]?\d+ %/.test(v),
		15_000
	);
	check(
		'trying shows the live guides without a stop-and-rate',
		/[+−]?\d+ %/.test(tried) &&
			(await count(page, '[data-testid=stop]')) === 0 &&
			(await count(page, '[data-testid=band-strip]')) === 1,
		tried.replace(/\s+/g, ' ')
	);
	const mapped = await until(
		() => page.getAttribute('[data-testid=live-map]', 'data-points'),
		(points) => Number(points) > 3,
		10_000
	);
	check(
		'a held sound leaves a trail on the map of pitch against brightness',
		Number(mapped) > 3 &&
			(await page.getAttribute('[data-testid=live-traces] [data-testid=traces]', 'data-rows')) ===
				'pitch_hz brightness_pct r1_pct lightness_db level_db',
		`${mapped} points`
	);
	check(
		'the meter says that its zero is the start of the take, not the everyday voice',
		(await text(page, '[data-testid=live-status]')).includes('not your everyday voice')
	);
	await page.click('[data-testid=set-zero]');
	check(
		'and the zero can be set by hand',
		(await page.getAttribute('[data-testid=set-zero]', 'data-set')) === 'true' &&
			(await text(page, '[data-testid=live-status]')).includes('the zero was set on')
	);
	await page.click('[data-testid=done-trying]');
	await page.waitForSelector('[data-testid=record]');
	await pause(1);
	const takesAfter = (await (await context.request.get('/api/v1/takes?limit=1000')).json()).length;
	check(
		'and leaves no take behind',
		takesAfter === takesBefore && (await count(page, '[data-testid=rating]')) === 0,
		`${takesBefore} → ${takesAfter}`
	);

	// --- practice: resonance is read against the everyday voice, with a live picture
	await page.goto('/practice/run?exercise=bright-phrase');
	await page.getByRole('button', { name: 'Skip' }).click();
	await page.click('[data-testid=record]');
	await page.waitForSelector('[data-testid=live-scope]');
	check(
		'a resonance step shows the formants live with the pitch strip, without the switch',
		(await count(page, '[data-testid=live-scope] [data-testid=spectrum-toggle]')) === 0 &&
			(await count(page, '[data-testid=band-strip]')) === 1
	);
	check(
		'and the live resonance, counted from the everyday takes of its text',
		(await page.getAttribute('[data-testid=live-resonance]', 'data-from')) === 'everyday'
	);
	await pause(2);
	await page.click('[data-testid=stop]');
	await page.waitForSelector('[data-testid=rating]');
	await page.click('[data-testid=comfort-4]');
	await page.waitForSelector('[data-testid=result] [data-testid=reading]', { timeout: 30_000 });
	check(
		'a spoken resonance step is read, not judged',
		(await count(page, '[data-testid=result] [data-testid=verdict]')) === 0
	);
	check(
		'a text read in the everyday voice before is read on resonance too',
		(await page.getAttribute('[data-testid=result] [data-testid=reading]', 'data-basis')) ===
			'same-text' &&
			(await count(page, '[data-testid=result] [data-shift=brightness_pct]')) === 1 &&
			(await count(page, '[data-testid=result] [data-testid=shift-strip]')) === 1
	);
	check(
		'and on lightness, beside the pitch',
		(await count(page, '[data-testid=result] [data-shift=lightness_shift_db]')) === 1
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
	check(
		'other words than the everyday takes are read on pitch, not on resonance',
		(await page.getAttribute('[data-testid=result] [data-testid=reading]', 'data-basis')) ===
			'speech' &&
			(await count(page, '[data-testid=result] [data-shift=pitch_shift_st]')) === 1 &&
			(await count(page, '[data-testid=result] [data-shift=brightness_pct]')) === 0 &&
			!(await text(page, '[data-testid=result] [data-testid=no-resonance]')).includes('Record')
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
	// every kind together: only the distances from the everyday voice compare
	await page.selectOption('[data-testid=kind]', 'all');
	await page.click('[data-testid=tab-measures]');
	await page.waitForSelector('[data-testid=panel-measures]');
	check(
		'all kinds together leave the measurements out and say why',
		(await count(page, '[data-testid=trends]')) === 0 &&
			(await text(page, '[data-testid=panel-measures]')).includes('one kind of take')
	);
	// a text read in both voices: the voice is the line, the range is drawn and named
	await page.selectOption('[data-testid=kind]', 'phrase:en');
	await page.click('[data-testid=tab-voice]');
	await page.waitForSelector('[data-chart=against-everyday] canvas');
	check(
		'the latest attempt is on tiles, one per distance',
		(await count(page, '[data-testid=tiles] [data-testid=stat-tile]')) === 6 &&
			/\d/.test(await text(page, '[data-testid=tiles] [data-testid=stat-value]'))
	);
	const drawn = await chartSeries(page, '[data-chart=against-everyday]');
	const lineOf = (list, voice) =>
		list.find((s) => s.id === `pitch_shift_st:pitch_shift_st:${voice}`);
	check(
		'an attempt is a solid line, the everyday voice a dashed one',
		lineOf(drawn, 'attempt')?.dash === 'solid' && Array.isArray(lineOf(drawn, 'habitual')?.dash),
		JSON.stringify(drawn.map((s) => [s.id, s.dash]))
	);
	const zones = drawn.find((s) => s.id === 'brightness_pct:ground')?.zones ?? [];
	check(
		'the ranges a resonance is read by are drawn and named',
		zones.some((zone) => zone.includes('where women')) &&
			zones.some((zone) => zone.includes('children')),
		zones.join(' | ')
	);
	await page.click('[data-testid=voice-attempt]');
	const without = await chartSeries(page, '[data-chart=against-everyday]');
	check(
		'a voice can be left out of the charts',
		!without.some((s) => `${s.id}`.endsWith(':attempt')) && Boolean(lineOf(without, 'habitual'))
	);
	await page.click('[data-testid=voice-attempt]');
	await page.click('[data-testid=by-day]');
	const daily = await chartSeries(page, '[data-chart=against-everyday]');
	check(
		'a point per day gathers the takes of that day',
		Array.isArray(lineOf(daily, 'attempt')?.takes[0]),
		JSON.stringify(lineOf(daily, 'attempt')?.takes)
	);
	await page.click('[data-testid=by-take]');
	// what each exercise was judged on, with the bar it sets
	await page.click('[data-testid=tab-exercises]');
	await page.waitForSelector('[data-drill=slide-down-hold] canvas');
	const hold = await chartSeries(page, '[data-drill=slide-down-hold]');
	check(
		'each exercise charts what it was judged on, with its bar',
		hold.some((s) => s.id === 'hold_s:hold_s') &&
			(hold.find((s) => s.id === 'hold_s:ground')?.bars ?? []).some((bar) =>
				bar.startsWith('at least')
			),
		JSON.stringify(hold.map((s) => [s.id, s.bars]))
	);
	// practice itself: the sessions day by day and one by one, and a row per exercise
	await page.click('[data-testid=tab-practice]');
	await page.waitForSelector('[data-chart=practice-sessions] canvas');
	check(
		'practice has a tab of its own: tiles, days, sessions, exercises',
		(await count(page, '[data-testid=practice-tiles] [data-testid=stat-tile]')) === 5 &&
			(await count(page, '[data-chart=practice-per-day] canvas')) === 1 &&
			(await count(page, '[data-chart=practice-calendar] canvas')) >= 1 &&
			(await count(page, '[data-testid=practice-exercises] tbody tr')) > 0
	);
	check(
		'the filters that sift takes are not offered where sessions are counted',
		(await count(page, '[data-testid=kind]')) === 0 &&
			(await count(page, '[data-testid=voice-attempt]')) === 0
	);
	const sessionSpot = await chartPoint(page, '[data-chart=practice-sessions]');
	await page
		.locator('[data-chart=practice-sessions] [data-testid=chart]')
		.click({ position: { x: sessionSpot.x, y: sessionSpot.y } });
	await page.waitForURL(/\/practice\/sessions\//);
	check('a click on a session opens it', true);
	// the list of sessions away: the tab says so, and the rest of the page stands
	const sessionsApi = '**/api/v1/practice';
	await page.route(sessionsApi, (route) => route.fulfill({ status: 500, body: 'no' }));
	await page.goto('/progress?tab=practice');
	await page.waitForSelector('[data-testid=practice-lost]');
	await page.click('[data-testid=tab-measures]');
	await page.waitForSelector('[data-testid=panel-measures]');
	check('without the list of sessions the tab says so and the page stands', true);
	await page.unroute(sessionsApi);
	await page.goto('/progress');
	await page.waitForSelector('[data-testid=view-reset]');
	await page.click('[data-testid=view-reset]');

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
