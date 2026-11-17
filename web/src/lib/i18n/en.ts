// English, the source of truth for the message keys: every other language
// is typed against this object.

export const en = {
	nav: {
		takes: 'Takes',
		practice: 'Practice',
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
		queued: (n: number) => (n === 1 ? '1 take waiting to upload' : `${n} takes waiting to upload`),
		practiceQueued: 'A practice session is waiting to upload.'
	},
	item: {
		vowels: 'Sustained vowels',
		glide: 'Pitch glide',
		sustain: 'Held sound',
		phrase: 'Short phrase',
		passage: 'Reading',
		free: 'Free speech',
		other: 'Other'
	},
	intent: {
		label: 'Voice',
		habitual: 'Everyday voice',
		attempt: 'Attempt',
		drill: 'Drill',
		habitualHint: 'How you speak without trying to change anything.',
		attemptHint: 'Your best current try at the voice you are training.',
		drillHint: 'A sound made for an exercise, not a voice.'
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
		contourTarget: (low: number, high: number) =>
			`The shaded band is your band when this was recorded: ${low}–${high} Hz.`,
		time: 'Time',
		vowels: 'The vowels, one by one',
		vowel: 'Vowel',
		pitch: 'Pitch',
		heldFor: 'Held',
		segments: 'The held sounds, one by one',
		exercise: 'Exercise',
		session: 'Practice session',
		comfort: 'Comfort'
	},
	progress: {
		title: 'Progress',
		intro:
			'One point per take. Compare like with like: one microphone setup and one kind of take at a time.',
		empty: 'No analysed take matches these filters yet.',
		kind: 'Kind of take',
		latest: 'latest',
		taken: 'Recorded',
		withPractice: 'Include attempts from practice sessions'
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
	practice: {
		title: 'Practice',
		intro:
			'Short guided sessions: a few drills, then speech. Pitch is a tool here, not a score; what you are after is a light, easy voice.',
		sessions: 'Sessions',
		minutes: (n: number) => `about ${n} min`,
		start: 'Start',
		catalogue: 'Exercises',
		alone: 'Practise this one',
		why: 'Why',
		safety: 'When to stop',
		sources: 'Sources',
		aliases: 'Also called',
		log: 'Practice log',
		logEmpty: 'No sessions yet.',
		takes: (n: number) => (n === 1 ? '1 take' : `${n} takes`),
		unfinished: 'not finished',
		single: 'One exercise',
		needBand: 'Set your band first: the drills are judged against it.',
		needDevice: 'Add a microphone setup first.',
		band: {
			title: 'Your band',
			intro:
				'The pitch range you practise in. It is a training tool you choose and can move at any time; the numbers in teachers’ material are conventions, not goals.',
			none: 'No band set yet.',
			low: 'From (Hz)',
			high: 'To (Hz)',
			set: 'Set band',
			starting: 'Use a common starting band: F3–A3, 174–220 Hz',
			conventions:
				'Sumi’s wiki uses about 200 Hz (G3) as a training pitch; the Scinguistics course aims at F3 to A3.',
			glide: (low: string, high: string) => `Your latest glide went from ${low} to ${high}.`,
			everyday: (hz: string) => `Your everyday voice: median ${hz}.`,
			invalid: 'The upper edge must lie at least a semitone above the lower one.'
		},
		run: {
			checkin: 'How does your voice feel today?',
			feel: {
				fresh: 'Fresh',
				normal: 'Normal',
				tired: 'Tired',
				hoarse: 'Hoarse or sore'
			} as Record<string, string>,
			hoarse: 'A hoarse or sore voice needs rest, not practice. Rest today and try again tomorrow.',
			rest: 'Rest today',
			gently: 'Go on, gently',
			language: 'Language of the spoken steps',
			begin: 'Begin',
			skip: 'Skip',
			step: (i: number, n: number) => `Exercise ${i} of ${n}`,
			rep: (i: number, n: number) => `rep ${i} of ${n}`,
			playNote: 'Play the note',
			yourNote: (name: string) => `Your note: ${name}`,
			record: 'Record',
			stop: 'Stop',
			listen: 'Listen back',
			comfort: 'How did that feel?',
			comforts: ['Strained', 'Effortful', 'Okay', 'Comfortable', 'Effortless'],
			measuring: 'Measuring…',
			offline: 'Kept on this device; it is measured once the app is reachable again.',
			met: 'Met',
			notYet: 'Not yet',
			hint: 'hint',
			hintNote: 'A hint, not a judgement: how far to trust it is on the measurement’s page.',
			next: 'Next rep',
			nextStep: (title: string) => `Next: ${title}`,
			toCheckout: 'Finish',
			skipStep: 'Skip this exercise',
			end: 'End the session',
			strained: 'Strained is a signal to stop. Rest, and next time go lighter or lower.',
			strainedNext: 'Go to the next exercise',
			strainedRetry: 'Try once more, lighter',
			effortful: 'Effortful: try it lighter, or a little lower.',
			strainedResult:
				'The numbers were there, but it was strained, so it does not count: lighter or lower next time.',
			checkout: 'How was the session as a whole?',
			tension: 'Did any tension in your throat or neck last after you stopped?',
			yes: 'Yes',
			no: 'No',
			tensionAdvice: 'Lasting tension means rest: no more voice practice today.',
			note: 'Note',
			finish: 'Save the session',
			done: 'Session saved.',
			summary: (takes: number, met: number) => `Takes: ${takes}, met: ${met}.`,
			toLog: 'Open it in the log',
			back: 'Back to practice'
		},
		problems: {
			'not-analysed': 'Not measured yet.',
			'no-band': 'No band was set for this take.',
			'no-note': 'No note was played for this take.',
			'too-little-voice': 'Too little voice to judge.',
			'not-measured': 'This could not be measured on the take.',
			'unknown-exercise': 'This exercise is no longer in the catalogue.'
		} as Record<string, string>,
		session: {
			title: 'Practice session',
			feel: 'At the start',
			comfort: 'Overall comfort',
			tension: 'Lasting tension',
			notFound: 'This session does not exist.',
			confirmDelete: 'Delete this session from the log? Its takes stay.'
		}
	},
	login: {
		title: 'Sign in',
		prompt: 'This puptrainer asks for its access token.',
		token: 'Access token',
		submit: 'Sign in',
		wrong: 'That token was not accepted.',
		signOut: 'Sign out'
	},
	queue: {
		title: 'Waiting to upload',
		rejected: 'Rejected by the API',
		practice: 'Practice session'
	}
};

export type Messages = typeof en;
