// English, the source of truth for the message keys: every other language
// is typed against this object.

export const en = {
	nav: { takes: 'Takes', record: 'Record', import: 'Import', devices: 'Microphones' },
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
		install: 'Install app'
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
		pitch: 'Median pitch',
		status: 'Analysis',
		allItems: 'Everything',
		allIntents: 'Any voice',
		allLanguages: 'Any language'
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
		saved: 'Saved'
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
		failed: (why: string) => `Recording failed: ${why}`
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
