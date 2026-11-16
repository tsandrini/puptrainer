// English, the source of truth for the message keys: every other language
// is typed against this object.

export const en = {
	nav: {
		takes: 'Takes',
		record: 'Record',
		progress: 'Progress',
		import: 'Import',
		devices: 'Microphones'
	},
	theme: { label: 'Theme', system: 'Follow the system', light: 'Light', dark: 'Dark' },
	groups: {
		recording: 'Recording',
		pitch: 'Pitch',
		resonance: 'Resonance',
		quality: 'Voice quality',
		range: 'Range'
	},
	common: {
		save: 'Save',
		cancel: 'Cancel',
		delete: 'Delete',
		edit: 'Edit',
		retry: 'Retry',
		discard: 'Discard',
		loading: 'Loading…',
		none: '—',
		language: 'Language',
		anyLanguage: 'no language',
		install: 'Install app',
		showValues: 'Show the values',
		hideValues: 'Hide the values'
	},
	status: {
		apiDown: 'The API is not reachable. Recordings are kept on this device until it is back.',
		workerDown: 'The analysis worker is not running: takes are stored, their numbers will follow.',
		queued: (n: number) => (n === 1 ? '1 take waiting to upload' : `${n} takes waiting to upload`)
	},
	item: {
		vowels: 'Sustained vowels',
		glide: 'Pitch glide',
		passage: 'Reading',
		free: 'Free speech',
		other: 'Other'
	},
	intent: {
		label: 'Voice',
		habitual: 'Everyday voice',
		attempt: 'Attempt',
		habitualHint: 'How you speak without trying to change anything.',
		attemptHint: 'Your best current try at the voice you are training.'
	},
	languages: { en: 'English', cs: 'Czech' } as Record<string, string>,
	analysis: {
		pending: 'Waiting for analysis',
		claimed: 'Analysing',
		done: 'Analysed',
		failed: 'Analysis failed',
		none: 'Not analysed',
		again: 'Analyse again'
	},
	takes: {
		title: 'Takes',
		empty: 'No takes yet. Record one, or import existing recordings.',
		emptyFiltered: 'No take matches these filters.',
		recorded: 'Recorded',
		what: 'What',
		device: 'Microphone',
		duration: 'Length',
		pitch: 'Pitch',
		status: 'Analysis',
		allItems: 'Everything',
		allIntents: 'Any voice',
		allLanguages: 'Any language',
		select: 'Select to compare',
		compare: 'Compare',
		compareHint: 'Tick two takes to compare them.',
		outdated: (n: number) =>
			n === 1
				? '1 take was analysed by an older version of the analysis.'
				: `${n} takes were analysed by an older version of the analysis.`,
		reanalyse: 'Analyse again'
	},
	take: {
		notFound: 'This take does not exist.',
		labels: 'Labels',
		note: 'Note',
		metrics: 'Measurements',
		noMetrics: 'No measurements yet.',
		file: 'File',
		original: 'Original name',
		format: (rate: number, channels: number) =>
			`${rate / 1000} kHz, ${channels === 1 ? 'mono' : `${channels} channels`}, FLAC`,
		pipeline: (version: string) => `pipeline ${version}`,
		passage: 'Text read',
		confirmDelete: 'Delete this take and its recording? This cannot be undone.',
		saved: 'Saved',
		contour: 'Pitch over the take',
		contourBand: 'The shaded band is 145–185 Hz.',
		time: 'Time',
		vowels: 'The vowels, one by one',
		vowel: 'Vowel',
		pitch: 'Pitch',
		heldFor: 'Held'
	},
	progress: {
		title: 'Progress',
		intro:
			'One point per take. Compare like with like: one microphone setup and one kind of take at a time.',
		empty: 'No analysed take matches these filters yet.',
		kind: 'Kind of take',
		latest: 'latest',
		taken: 'Recorded'
	},
	compare: {
		title: 'Compare two takes',
		pick: 'Tick two takes in the list, then choose Compare.',
		back: 'Back to the takes',
		metric: 'Measurement',
		difference: 'B − A',
		setups:
			'These takes come from different microphone setups: differences in resonance, slope and level may be the setup, not the voice.',
		kinds: 'These takes are of different kinds: only some measurements can be compared.'
	},
	record: {
		title: 'Record',
		needDevice: 'Add a microphone setup first, so takes can be told apart later.',
		addDevice: 'Add a microphone',
		setup: 'Microphone setup',
		input: 'Input',
		defaultInput: 'System default',
		what: 'What to record',
		start: 'Start recording',
		stop: 'Stop',
		recording: 'Recording',
		level: 'Level',
		target: 'aim for −12 to −6 dBFS at the loudest',
		tooQuiet: 'Too quiet: raise the gain or move the microphone closer.',
		clipping: 'Clipping: lower the gain.',
		pitch: 'Pitch (live, a guide only)',
		review: 'Review',
		peak: (db: string) => `peak ${db} dBFS`,
		clipped: (n: number) => `${n} clipped samples: record again with less gain.`,
		saveTake: 'Save take',
		again: 'Record again',
		saved: 'Saved. It will be analysed shortly.',
		savedOffline: 'Kept on this device; it uploads when the API is reachable.',
		denied: 'The browser refused the microphone. Allow it for this site and try again.',
		noMic: 'No microphone was found.',
		insecure: 'Recording needs a secure page (https or localhost).',
		failed: (why: string) => `Recording failed: ${why}`,
		baseline: 'Baseline',
		baselineToday: (done: number, total: number) => `${done} of ${total} recorded today`,
		recordedToday: 'recorded today'
	},
	import: {
		title: 'Import recordings',
		intro:
			'WAV or FLAC files. Names like 2026-11-16_passage-en_habitual.wav fill in the labels by themselves.',
		choose: 'Choose files',
		file: 'File',
		date: 'Recorded',
		importAll: (n: number) => (n === 1 ? 'Import 1 file' : `Import ${n} files`),
		done: (n: number) => (n === 1 ? '1 file queued for upload.' : `${n} files queued for upload.`),
		remove: 'Remove'
	},
	devices: {
		title: 'Microphones',
		intro:
			'One entry per setup: the microphone and how it is placed. Takes are only compared within a setup.',
		name: 'Name',
		kind: 'Kind',
		note: 'Setup notes',
		notePlaceholder: 'Where it sits, the gain, the room',
		add: 'Add microphone',
		empty: 'No microphone setups yet.',
		kinds: {
			lavalier: 'Lavalier',
			headset: 'Headset',
			desktop: 'Desktop microphone',
			laptop: 'Laptop',
			phone: 'Phone',
			other: 'Other'
		}
	},
	queue: {
		title: 'Waiting to upload',
		rejected: 'Rejected by the API'
	}
};

export type Messages = typeof en;
