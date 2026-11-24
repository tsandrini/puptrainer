// The README's screenshots, taken from a demo dataset: a week of takes of two
// made-up people whose voices are synthesised here (vowels on a pitch line,
// no recording of anybody). The script fills an API whose data directory is
// EMPTY with those takes, has them analysed, and photographs the pages in a
// headless Chromium whose microphone is one of the synthetic voices.
//
//   node web/scripts/screenshots.mjs --base http://127.0.0.1:8438 \
//     --worker "puptrainer-worker" --out docs/assets/images
//
// It refuses an API that already holds takes, so it cannot land in a real
// database. Needs `PLAYWRIGHT_CORE` and `PLAYWRIGHT_BROWSERS_PATH`, as the
// end-to-end run does; docs/development.md has the lines.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		base: { type: 'string', default: 'http://127.0.0.1:8438' },
		worker: { type: 'string' },
		out: { type: 'string', default: 'docs/assets/images' }
	}
});
if (!process.env.PLAYWRIGHT_CORE || !args.worker) {
	console.error('PLAYWRIGHT_CORE and --worker are required: see docs/development.md.');
	process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);

const RATE = 48000;
const DAY = 86_400_000;
/** The last day of the demo week: a fixed one, so every run draws the same pictures. */
const LAST_DAY = new Date(2026, 10, 24).getTime();
const SIZE = { width: 1440, height: 900 };
const api = `${args.base}/api/v1`;

// --- synthetic voices

/** The first four resonances of five vowels, of a large (low) vocal tract. */
const VOWELS = {
	a: [730, 1090, 2440, 3400],
	e: [530, 1840, 2480, 3500],
	i: [270, 2290, 3010, 3600],
	o: [570, 840, 2410, 3400],
	u: [300, 870, 2240, 3400]
};

/**
 * A seeded generator (mulberry32): every run draws the same voices.
 *
 * @param {number} seed
 * @returns {() => number} Numbers from 0 (inclusive) to 1 (exclusive), the same for a seed.
 */
function seeded(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * From 0 to 1 without a corner at either end.
 *
 * @param {number} x How far along; clamped to 0..1.
 */
const ease = (x) => Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, x))) ** 2;

/**
 * How loud each of the first `count` harmonics of `f0` comes out of a vocal tract
 * with these resonances. The resonances are continued upwards at the spacing of the
 * last two, as a tube's are; `leadDb` raises the fundamental over the rest, as a
 * light voice does. Nothing sounds above 8 kHz.
 *
 * @param {number} f0 The pitch, in Hz.
 * @param {number[]} formants The first resonances, in Hz, lowest first (at least two).
 * @param {number} leadDb
 * @param {number} count
 * @returns {Float64Array} A gain per harmonic, the fundamental first.
 */
function harmonics(f0, formants, leadDb, count) {
	const centres = [...formants];
	const step = centres.at(-1) - centres.at(-2);
	while (centres.at(-1) + step < 20000) centres.push(centres.at(-1) + step);
	const gains = new Float64Array(count);
	for (let k = 1; k <= count && k * f0 < 8000; k++) {
		const f = k * f0;
		// the source falls off by 6 dB per octave
		let gain = (k === 1 ? 10 ** (leadDb / 20) : 1) / k;
		for (const centre of centres) {
			const width = 80 + 0.02 * centre;
			gain /= Math.sqrt((1 - (f / centre) ** 2) ** 2 + ((f * width) / centre ** 2) ** 2);
		}
		gains[k - 1] = gain;
	}
	return gains;
}

/**
 * A voice as a few numbers.
 *
 * @typedef {object} Voice
 * @property {number} f0 The pitch it speaks around, in Hz.
 * @property {number} scale A factor on every resonance: above 1 is a smaller, brighter voice.
 * @property {number} leadDb How far the fundamental stands over the harmonics: a lighter voice.
 * @property {number} breath How much breath noise it carries, 0 to about 0.05.
 * @property {number} level Its peak level, 0 to 1.
 */

/**
 * A stretch of voice on one vowel.
 *
 * @typedef {object} Part
 * @property {number} start When it starts, in seconds.
 * @property {number} end When it ends. A part that starts right then goes on without a break.
 * @property {keyof typeof VOWELS} vowel
 * @property {number} weight How loud it is, 0 to 1.
 * @property {(at: number) => number} pitch Its pitch over its length (0 to 1), as a factor
 *     on the voice's.
 */

/** How long a vowel takes to turn into the next one, in seconds. */
const GLIDE_S = 0.06;
/** What a quiet room adds to every recording: about −62 dBFS. */
const ROOM = 0.0008;

/**
 * A voice saying a plan of parts.
 *
 * @param {Voice} voice
 * @param {Part[]} parts In the order they sound.
 * @param {number} seconds The length of the whole sound.
 * @param {() => number} random For the breath and the room.
 * @returns {Float32Array}
 */
function sound(voice, parts, seconds, random) {
	const BLOCK = 240; // the harmonics are weighed anew every 5 ms, and eased between
	const low = Math.min(
		...parts.map((part) => Math.min(part.pitch(0), part.pitch(0.5), part.pitch(1)))
	);
	const count = Math.floor(8000 / (voice.f0 * low));
	const samples = new Float32Array(Math.round(seconds * RATE));
	let phase = 0;
	parts.forEach((part, index) => {
		const after = parts[index + 1];
		const joined = {
			before: index > 0 && parts[index - 1].end === part.start,
			after: after?.start === part.end
		};
		const own = VOWELS[part.vowel];
		const next = joined.after ? VOWELS[after.vowel] : own;
		const from = Math.round(part.start * RATE);
		const to = Math.min(Math.round(part.end * RATE), samples.length);
		const turn = to - Math.min(GLIDE_S * RATE, (to - from) / 2);
		/** How far the part has turned into the next one at a sample. */
		const turned = (i) => (joined.after ? ease((i - turn) / (to - turn)) : 0);
		const weigh = (i) => {
			const mix = turned(i);
			const formants = own.map((f, n) => (f + (next[n] - f) * mix) * voice.scale);
			return harmonics(
				voice.f0 * part.pitch((i - from) / (to - from)),
				formants,
				voice.leadDb,
				count
			);
		};
		let [now, then] = [weigh(from), weigh(from)];
		for (let i = from; i < to; i++) {
			const step = (i - from) % BLOCK;
			if (step === 0) [now, then] = [then, weigh(Math.min(i + BLOCK, to))];
			phase += (2 * Math.PI * voice.f0 * part.pitch((i - from) / (to - from))) / RATE;
			let value = 0;
			for (let k = 0; k < count; k++)
				value += (now[k] + ((then[k] - now[k]) * step) / BLOCK) * Math.sin((k + 1) * phase);
			const weight =
				part.weight + ((joined.after ? after.weight : part.weight) - part.weight) * turned(i);
			// a soft start and end, where the voice starts and ends
			const opening = joined.before ? 1 : ease((i - from) / (0.03 * RATE));
			const closing = joined.after ? 1 : ease((to - i) / (0.05 * RATE));
			samples[i] = value * weight * opening * closing;
		}
	});
	let peak = 0;
	for (const value of samples) peak = Math.max(peak, Math.abs(value));
	let voiced = 0;
	for (let i = 0; i < samples.length; i++) {
		const value = samples[i] / (peak || 1);
		// breath rides on the voice and dies with it; the room is always there
		voiced = Math.max(Math.abs(value), voiced * 0.9995);
		samples[i] =
			voice.level * (value + voice.breath * voiced * (random() * 2 - 1)) +
			ROOM * (random() * 2 - 1);
	}
	return samples;
}

/**
 * A text as a voice would say it: phrases of syllables, each a vowel, on a pitch line
 * that starts high and falls, with a closure after some syllables and a breath between
 * phrases. The same seed is the same text: the same vowels in the same rhythm.
 *
 * @param {number} seed Which text.
 * @param {number} seconds About how long it takes to say.
 * @returns {Part[]}
 */
function sentence(seed, seconds) {
	const random = seeded(seed);
	const names = Object.keys(VOWELS);
	const parts = [];
	let at = 0.35;
	while (at < seconds - 1) {
		const start = at;
		const drawn = [];
		for (let left = 6 + Math.floor(random() * 6); left > 0 && at < seconds - 0.7; left--) {
			const length = 0.13 + random() * 0.16;
			drawn.push({
				start: at,
				end: at + length,
				vowel: names[Math.floor(random() * names.length)],
				weight: 0.6 + random() * 0.4,
				accent: random() < 0.3 ? 0.08 + random() * 0.1 : 0
			});
			at += length;
			// about one syllable in three ends in a closure
			if (random() < 0.35) at += 0.04 + random() * 0.07;
		}
		const length = at - start;
		for (const { accent, ...syllable } of drawn) {
			parts.push({
				...syllable,
				pitch: (x) =>
					(1.13 -
						(0.25 * (syllable.start + x * (syllable.end - syllable.start) - start)) / length) *
					(1 + accent * Math.sin(Math.PI * x))
			});
		}
		at += 0.35 + random() * 0.45;
	}
	return parts;
}

/**
 * A voice reading a text.
 *
 * @param {Voice} voice
 * @param {Part[]} text
 * @param {number} pace How slowly: 1 is the text's own time.
 * @param {number} seed For the breath and the room.
 * @returns {Float32Array}
 */
function speech(voice, text, pace, seed) {
	const parts = text.map((part) => ({ ...part, start: part.start * pace, end: part.end * pace }));
	return sound(voice, parts, parts.at(-1).end + 0.5, seeded(seed));
}

/**
 * Three held vowels with pauses between: a, i, u.
 *
 * @param {Voice} voice
 * @returns {Float32Array}
 */
function vowels(voice) {
	const parts = ['a', 'i', 'u'].map((vowel, index) => ({
		start: 0.4 + index * 2.7,
		end: 2.5 + index * 2.7,
		vowel,
		weight: 1,
		pitch: (x) => 1 + 0.012 * Math.sin(2 * Math.PI * 2.6 * x)
	}));
	return sound(voice, parts, 8.4, seeded(11));
}

/**
 * One vowel slid from the bottom of a voice to its top and back.
 *
 * @param {Voice} voice
 * @returns {Float32Array}
 */
function glide(voice) {
	const part = {
		start: 0.4,
		end: 6.6,
		vowel: 'a',
		weight: 1,
		pitch: (x) => 2 ** (1.7 * Math.sin(Math.PI * x) ** 2 - 0.45)
	};
	return sound(voice, [part], 7, seeded(13));
}

/**
 * Samples as a 16-bit mono WAV file.
 *
 * @param {Float32Array} samples Between -1 and 1; what lies outside is clipped.
 * @returns {Buffer}
 */
function wav(samples) {
	const buffer = Buffer.alloc(44 + 2 * samples.length);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + 2 * samples.length, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(RATE, 24);
	buffer.writeUInt32LE(2 * RATE, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(2 * samples.length, 40);
	for (let i = 0; i < samples.length; i++) {
		const value = Math.max(-1, Math.min(1, samples[i]));
		buffer.writeInt16LE(Math.round(value * 32767), 44 + 2 * i);
	}
	return buffer;
}

// --- the demo dataset

/** The passage, and two things said freely. */
const PASSAGE = sentence(7, 13);
const FREE = [sentence(21, 11), sentence(22, 11)];

/**
 * The learner's everyday voice, give or take what a day does to it.
 *
 * @param {() => number} random
 * @returns {Voice}
 */
const everyday = (random) => ({
	f0: 122 + random() * 6,
	scale: 0.995 + random() * 0.012,
	leadDb: 0,
	breath: 0.012,
	level: 0.42 + random() * 0.05
});
/**
 * The learner's attempts over a week: high, thin and quiet at first, then brighter,
 * with more voice in it.
 *
 * @param {number} day 0 (the first day) to 6.
 * @returns {Voice}
 */
const attempt = (day) => ({
	f0: 196 - 1.5 * day,
	scale: 1.045 + 0.011 * day,
	leadDb: 7.5 - 0.8 * day,
	breath: 0.04 - 0.004 * day,
	level: 0.29 + 0.016 * day
});
/**
 * Somebody whose voice sits where the learner is heading, for comparison.
 *
 * @type {Voice}
 */
const FRIEND = { f0: 204, scale: 1.14, leadDb: 1, breath: 0.012, level: 0.4 };

/**
 * Asks the API.
 *
 * @param {string} path Below `/api/v1/`.
 * @param {RequestInit} [init]
 * @returns {Promise<any>} The answer's JSON; `null` for an answer without one.
 * @throws {Error} When the API refuses.
 */
async function request(path, init) {
	const response = await fetch(`${api}/${path}`, init);
	if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
	return response.status === 204 ? null : response.json();
}
const post = (path, body) =>
	request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

/**
 * Stores a sound as a take.
 *
 * @param {Float32Array} samples
 * @param {object} meta The take's labels, as the API's `TakeMeta`.
 * @returns {Promise<any>} The stored take.
 */
async function upload(samples, meta) {
	const form = new FormData();
	form.append('file', new Blob([wav(samples)], { type: 'audio/wav' }), 'demo.wav');
	form.append('meta', JSON.stringify(meta));
	return request('takes', { method: 'POST', body: form });
}

/**
 * Fills the empty API with a week of takes. Ends the script when the API is not empty.
 *
 * @returns {Promise<{ me: number, friend: number, everyday: string, attempt: string }>}
 *     What the pages are found by: the two people, and the last day's two takes.
 */
async function seed() {
	if ((await request('takes?limit=1')).length) {
		console.error('This API already holds takes. The demo data only goes into an empty one.');
		process.exit(2);
	}
	const content = await request('content');
	const passage = content.passages.find((p) => p.id === 'garden-en');
	const text = `passage:${passage.id}@${passage.version}`;
	const device = await post('devices', {
		name: 'Lavalier',
		kind: 'lavalier',
		note: 'Clipped to the collar, a hand below the chin.'
	});
	const [me] = await request('people');
	const friend = await post('people', { name: 'A friend', note: 'For comparison.' });
	await post('bands', { low_hz: 175, high_hz: 220 });

	const random = seeded(2026);
	/** A moment `ago` days before the demo week's last day, at a time of day. */
	const moment = (ago, hours, minutes) =>
		new Date(LAST_DAY - ago * DAY + (hours * 60 + minutes) * 60_000).toISOString();
	const base = { device_id: device.id, item: 'passage', language: 'en', content_ref: text };
	const found = { me: me.id, friend: friend.id, everyday: '', attempt: '' };

	for (let day = 0; day < 7; day++) {
		const ago = 6 - day;
		console.log(`day ${day + 1} of 7`);
		const plain = await upload(speech(everyday(random), PASSAGE, 0.98 + random() * 0.06, day), {
			...base,
			intent: 'habitual',
			recorded_at: moment(ago, 8, 40 + Math.floor(random() * 15))
		});
		const tried = await upload(speech(attempt(day), PASSAGE, 1.02 + random() * 0.06, 50 + day), {
			...base,
			intent: 'attempt',
			recorded_at: moment(ago, 9, 5 + Math.floor(random() * 15))
		});
		[found.everyday, found.attempt] = [plain.id, tried.id];
		if (day === 0) {
			await upload(vowels(everyday(random)), {
				device_id: device.id,
				item: 'vowels',
				intent: 'habitual',
				recorded_at: moment(ago, 8, 20)
			});
			await upload(glide(everyday(random)), {
				device_id: device.id,
				item: 'glide',
				intent: 'habitual',
				recorded_at: moment(ago, 8, 25)
			});
		}
		if (day === 3) {
			for (const [index, [intent, voice]] of [
				['habitual', everyday(random)],
				['attempt', attempt(day)]
			].entries()) {
				await upload(speech(voice, FREE[index], 1, 70 + index), {
					device_id: device.id,
					item: 'free',
					language: 'en',
					intent,
					recorded_at: moment(ago, 18, intent === 'attempt' ? 30 : 20)
				});
			}
		}
	}
	await upload(speech(FRIEND, PASSAGE, 0.97, 90), {
		...base,
		person_id: friend.id,
		intent: 'habitual',
		recorded_at: moment(0, 12, 10),
		note: 'Their usual voice, on my microphone.'
	});
	return found;
}

/**
 * Runs the worker until every take is analysed.
 *
 * @throws {Error} When an analysis fails, or they are not done in a quarter of an hour.
 */
async function analyse() {
	const worker = spawn(args.worker, {
		shell: true,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, PUPTRAINER_API_URL: args.base, PUPTRAINER_POLL_INTERVAL_S: '0.5' }
	});
	const stop = () => {
		try {
			process.kill(-worker.pid);
		} catch {
			// already gone
		}
	};
	process.on('exit', stop);
	const deadline = Date.now() + 15 * 60_000;
	for (;;) {
		const takes = await request('takes?limit=1000');
		const failed = takes.filter((take) => take.analysis?.status === 'failed');
		if (failed.length) throw new Error(`analysis failed: ${failed[0].analysis.error}`);
		if (takes.every((take) => take.analysis?.status === 'done')) break;
		if (Date.now() > deadline) throw new Error('the analysis did not finish in time');
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	stop();
}

// --- the photographs

const found = await seed();
console.log('analysing');
await analyse();

const scratch = mkdtempSync(join(tmpdir(), 'puptrainer-screenshots-'));
const microphone = join(scratch, 'voice.wav');
writeFileSync(microphone, wav(speech(attempt(6), PASSAGE, 1.04, 99)));
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
	args: [
		'--use-fake-device-for-media-stream',
		'--use-fake-ui-for-media-stream',
		`--use-file-for-fake-audio-capture=${microphone}`
	]
});
try {
	/**
	 * One page, photographed.
	 *
	 * @param {string} name The file's name, without its ending.
	 * @param {string} path Where in the app.
	 * @param {{ dark?: boolean, height?: number, ready: string, then?: (page: any) => Promise<void> }} how
	 *     `ready` is a selector that is there once the page has drawn; `then` does what
	 *     is left to do before the picture.
	 */
	async function shoot(name, path, { dark = false, height = SIZE.height, ready, then }) {
		const context = await browser.newContext({
			baseURL: args.base,
			locale: 'en-GB',
			viewport: { ...SIZE, height },
			colorScheme: dark ? 'dark' : 'light',
			permissions: ['microphone']
		});
		const page = await context.newPage();
		await page.goto(path);
		await page.waitForSelector(ready, { timeout: 30_000 });
		await then?.(page);
		// charts and spectrograms settle after their first paint
		await page.waitForTimeout(1500);
		await page.screenshot({ path: join(out, `${name}.png`) });
		await context.close();
		console.log(`${name}.png`);
	}

	const both = `who=${found.me},${found.friend}&kind=passage:en`;
	await shoot('showcase_progress', `/progress?tab=voice&${both}`, {
		height: 1010,
		ready: '[data-chart=against-everyday] canvas'
	});
	await shoot('showcase_relations', '/progress?tab=relations&kind=passage:en', {
		height: 700,
		ready: '[data-chart=scatter] canvas'
	});
	await shoot('showcase_take', `/takes/${found.attempt}`, {
		ready: '[data-testid=traces] canvas',
		then: (page) => page.waitForSelector('[data-testid=player][data-ready=true]')
	});
	await shoot('showcase_takes', '/', {
		height: 760,
		ready: '[data-testid=takes] tbody tr a'
	});
	await shoot('showcase_compare', `/compare?a=${found.everyday}&b=${found.attempt}`, {
		dark: true,
		ready: '[data-testid=compare-traces] canvas',
		then: (page) => page.click('[data-testid=compare-align]')
	});
	await shoot('showcase_record', '/record', {
		ready: '[data-testid=what]',
		then: async (page) => {
			await page.selectOption('[data-testid=what]', 'baseline:passage-en');
			await page.selectOption('[data-testid=intent]', 'attempt');
			await page.click('[data-testid=start]');
			await page.waitForSelector('[data-testid=stop]');
			// long enough for the meters and the graph of the last seconds to fill
			await page.waitForTimeout(12_000);
			await page
				.locator('[data-testid=stop]')
				.evaluate((stop) => window.scrollTo(0, stop.getBoundingClientRect().top + scrollY - 28));
		}
	});
} finally {
	await browser.close();
}
