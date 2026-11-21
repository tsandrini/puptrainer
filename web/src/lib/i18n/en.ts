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
	groupIntro: {
		recording: 'About the take, not the voice: whether its numbers can be trusted.',
		pitch: 'The first target: how fast the vocal folds vibrate.',
		resonance: 'The second target: what the space above the vocal folds does to their sound.',
		quality:
			'Not a target: the condition on both. A change counts when the voice stays clear and easy.',
		range: 'The room for the first target: the notes the voice reaches at all.'
	},
	targets: {
		pitch: 'Pitch',
		resonance: 'Resonance',
		condition: 'What it costs',
		intro: {
			pitch:
				'The first target: how fast the vocal folds vibrate. It is the strongest single cue to how a voice is heard, and the easiest one to push too far.',
			resonance:
				'The second target: what the space above the vocal folds does to their sound. A smaller space raises the resonances and makes a voice sound smaller and brighter, at any pitch.',
			condition:
				'Not a target: the condition both targets have to meet. A change counts when the voice stays about as loud, as clear and as easy as your everyday voice.'
		}
	},
	reading: {
		title: 'Against your everyday voice',
		basis: {
			'same-text': (n: number) =>
				n === 1
					? 'Counted from your one everyday take of the same text.'
					: `Counted from your first ${n} everyday takes of the same text.`,
			'same-kind': (n: number) =>
				n === 1
					? 'Counted from your one everyday take of this kind: other words, so resonance is rougher than on a text.'
					: `Counted from your first ${n} everyday takes of this kind: other words each time, so resonance is rougher than on a text.`,
			speech: (n: number) =>
				n === 1
					? 'Counted from your one everyday take of speech, which is other words.'
					: `Counted from your first ${n} everyday takes of speech, which are other words.`,
			vowels: (n: number) =>
				n === 1
					? 'Counted from your one everyday take of the vowels, vowel by vowel.'
					: `Counted from your first ${n} everyday takes of the vowels, vowel by vowel.`
		},
		everyday: (value: string) => `everyday ${value}`,
		scatter: (value: string) => `your everyday takes scatter by ±${value}`,
		zero: 'everyday',
		clipped:
			'This take clipped, so its numbers are less sure: softer, or further from the microphone.',
		yours: 'the scatter of your everyday takes',
		noResonance:
			'Resonance is not compared here: these are other words than in your everyday takes, and formants follow the words.',
		recordText:
			'Record this text once in your everyday voice (Record, under “What to record”) and every take of it will be read on resonance too.',
		none: 'There is no everyday take to read this one against yet. Record this kind of take once in your everyday voice.',
		r1Unreadable: 'not readable on this take',
		notes: {
			everyday: 'Resonance: within the scatter of your everyday takes. Nothing has moved here.',
			darker: 'Resonance: darker than your everyday voice.',
			brighter:
				'Resonance: clearly brighter than your everyday voice, and short of where women’s voices sit. This is enough to work with: the next step is holding it with less effort, not pushing it further.',
			typical:
				'Resonance: inside the range where women’s voices sit. More is not needed; ease and steadiness are.',
			beyond:
				'Resonance: past the range of adult voices. This much tends to sound child-like or pinched, and posture rarely reaches it without strain: ease off.',
			'r1-unreadable':
				'The first resonance (R1) is not read on this take: the voice is too high and light for it. The analysis finds the pitch where the resonance should be, so the number would follow the pitch and say nothing about the throat. A whisper shows R1 reliably.',
			lighter:
				'Lighter than your everyday voice: the fundamental stands further above the harmonics over it. This is the “weight” going down, which is where the training usually heads.',
			heavier:
				'Heavier than your everyday voice: the harmonics stand closer to the fundamental, as in a firmer or louder voice.',
			quieter:
				'Clearly quieter than your everyday voice: often a sign of holding back or squeezing.',
			'less-clear':
				'The tone is less clear than in your everyday voice: breath or strain got in. Ease off until it is clean again.'
		} as Record<string, string>
	},
	traces: {
		title: 'The take, moment by moment',
		reads:
			'Three grids on the time axis of the picture above, one per unit. The legend under each says its values at the pointer, or where the playback stands. Click a moment to hear it; drag across to zoom in, double-click to zoom out.',
		grids: {
			pitch: 'Pitch (Hz)',
			resonance: 'Resonance (% against the zero)',
			source: 'The source (dB against the zero)',
			sourceOwn: 'The source (dB against the middle of this take)'
		},
		live: 'What the live guide drew while you recorded, on the time axis of the picture above. The saved take is measured more carefully.',
		rows: {
			pitch_hz: 'Pitch',
			pitch_pct: 'Pitch, against the first sound',
			brightness_pct: 'Brightness',
			r1_pct: 'First resonance (R1)',
			lightness_db: 'Lightness',
			clarity_db: 'Clarity',
			level_db: 'Loudness'
		} as Record<string, string>,
		hints: {
			pitch_pct:
				'The pitch once more, as a percentage against the first sound, so it can be read on one scale with the resonances: a semitone is 6%. Where this line moves and the others do not, only the note changed.',
			pitch_hz:
				'How fast the vocal folds vibrate. The shaded band is the pitch band the take was recorded against, or 145–185 Hz.',
			brightness_pct:
				'How much higher the upper resonances (F2 to F4) sit than at the zero. The shaded stretch is where women’s voices sit above an average man’s.',
			r1_pct:
				'How much higher the lowest resonance sits than at the zero. Greyed out where the voice is too light for it to be read: there the analysis finds the pitch, not the resonance.',
			lightness_db:
				'How far the fundamental stands above the next harmonic. Higher is a lighter, thinner voice: the “weight” teachers speak of, going down.',
			clarity_db:
				'How clearly periodic the tone is. Breath and roughness lower it: a dip here together with a rise in lightness is air.',
			level_db: 'How loud it is, in dB below full scale.'
		} as Record<string, string>,
		zero: {
			'first-sound': 'Brightness and R1 are counted from the first held sound of this take.',
			'first-whisper':
				'Brightness and R1 are counted from the first three whispered seconds of this take.'
		},
		shaded: 'Where the resonance grid is greyed out, the voice is too light for R1 to be read.',
		unreadable: 'not readable',
		whisper: 'whisper',
		older:
			'This take was analysed by an older version, which kept its pitch only: analyse it again for the other rows.',
		speech:
			'Resonance follows the words, so speech has no brightness row: its brightness is one number for the whole take, below.',
		what: 'What the rows show'
	},
	live: {
		title: 'Resonance, live',
		caption:
			'A guide while you speak. The saved take is measured more carefully and usually reads higher.',
		soFar: 'this take so far',
		recent: (seconds: number) => `the last ${seconds} s`,
		brightness: 'Brightness',
		first: 'R1',
		settingZero: (heard: string, need: string) =>
			`Setting the zero from your first sound: ${heard} of ${need} s.`,
		fromStart: '0% is the first sound of this take, not your everyday voice.',
		fromSet: '0% is the sound the zero was set on.',
		setZero: 'Set the zero here',
		setZeroHint: 'Make your ordinary sound and press this: everything after is counted from it.',
		graph: {
			title: (seconds: number) => `The last ${seconds} seconds`,
			reads:
				'What the microphone hears as it comes: the newest moment is at the right edge. A guide; the saved take is measured more carefully.',
			speech:
				'What the microphone hears as it comes. In speech the brightness follows every vowel, so its row is the last eight seconds, a slow line; pitch, lightness and loudness are the moment.',
			map: 'Pitch against brightness',
			mapReads:
				'Pitch grows to the right, brightness upwards. Straight up is resonance without pitch; a diagonal is both together.',
			pitchAxis: 'pitch',
			brightAxis: 'brighter'
		},
		fromEveryday: 'Counted from your everyday takes of this text.',
		fromKind:
			'Counted from your everyday free speech: other words, so it moves more than on a text.',
		preparing: 'Measuring your everyday takes for the live reference…',
		none: 'No everyday take of this text yet (or, for free speech, of free speech), so there is nothing to count from: record it once in your everyday voice.',
		waiting: 'Waiting for sound…',
		tooHigh: 'Above 300 Hz the resonance cannot be read: bring the pitch down.'
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
			'One point per take, for one microphone setup and one kind of take at a time, over the stretch of time you choose. First each take against your everyday voice, then any two measures against each other, then every measurement and every exercise by itself.',
		against: 'against your everyday voice',
		hear: 'Hear a take when the pointer rests on its point',
		zoomHint:
			'Drag across a chart to zoom every chart into that stretch; double-click to zoom back out. Click a point to pin its take to the card above; click it again, or press Esc, to unpin.',
		zoomOut: 'Show the whole stretch again',
		everydayGroup: 'Against your everyday voice',
		everydayReads:
			'Each take as its distance from your everyday voice, one grid per unit. Filled points are attempts; hollow ones are everyday takes, which scatter around zero.',
		grids: {
			pitch: 'Pitch (semitones)',
			resonance: 'Resonance (%)',
			source: 'The source (dB)'
		},
		cross: 'One measure against another',
		crossReads:
			'One point per take. Pick any two measures to see whether they go together across your takes. The dashed line is their straight-line fit; r says how closely they follow it (0: not at all, ±1: exactly). With both voices ticked, r mostly says how your attempts differ from your everyday takes; untick one to look inside a voice. A handful of takes makes a hint, not a law.',
		crossX: 'Across',
		crossY: 'Upwards',
		crossStat: (r: string, n: number) => `r = ${r} over ${n} takes`,
		crossFew: 'Fewer than three takes have both measures here.',
		measures: 'Measure by measure',
		drills: 'Exercises',
		drillsReads:
			'What each exercise was judged on, take by take, on this microphone setup and in this stretch of time.',
		empty: 'No analysed take matches these filters yet.',
		kind: 'Kind of take',
		allKinds: 'All kinds, against the everyday voice',
		allReads:
			'Every kind of take together, each as its distance from your everyday voice of the same kind. The measurements themselves only compare within one kind, so they are left out here; kinds also differ among themselves (a short phrase is spoken louder than a passage).',
		latest: 'latest',
		taken: 'Recorded',
		withPractice: 'Include attempts from practice sessions'
	},
	range: {
		label: 'Time',
		all: 'everything',
		last: (days: number) => `last ${days} days`,
		quick: 'Quick ranges',
		exact: 'Exact',
		from: 'From',
		to: 'To',
		untilNow: 'Until now',
		apply: 'Apply',
		problems: {
			incomplete: 'Both a start and an end are needed.',
			backwards: 'The end has to lie after the start.'
		}
	},
	card: {
		none: 'Rest the pointer on a point of a chart to see its take here; click the point to pin it.',
		open: 'Open the take',
		unpin: 'Unpin',
		unpinHint: 'The card follows the pointer again (Esc)',
		comfort: (rating: number) => `comfort ${rating}`,
		problems: {
			blocked: 'The browser plays sound only after a click on the page: click anywhere once.',
			failed: 'This recording could not be played.'
		}
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
		recordedToday: 'recorded today',
		texts: 'Exercise texts',
		textsHint:
			'Read each in your everyday voice, on three days if you can: then every take of it is read on resonance too.',
		textTaken: (n: number) =>
			n === 1 ? 'in your everyday voice: 1 take' : `in your everyday voice: ${n} takes`
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
			'Two short guided sessions, one per target: pitch and resonance. Each is a few drills, then speech. The numbers are tools, not scores; what you are after is a voice that is easy to hold.',
		sessions: 'Sessions',
		minutes: (n: number) => `about ${n} min`,
		start: 'Start',
		catalogue: 'Exercises',
		alone: 'Practise this one',
		why: 'What it is for',
		right: 'When it goes right',
		mistakes: 'Common mistakes',
		safety: 'When to stop',
		advice: {
			'above-band':
				'You were above your band. Try lower: it should feel easier, and nothing is gained by going higher.',
			'below-band':
				'You were below your band. Start from a light, higher sound and slide down into it.',
			unsteady:
				'You got there but did not stay. Arrive, then hold one steady note a little longer.',
			effortful:
				'The numbers are there, but it took effort. Next time go lower or lighter: easy matters more than high.',
			'pitch-moved':
				'Your pitch moved between the sounds. The exercise is to change the colour while the note stays put: hum your note before each sound and watch the marker.',
			'pitch-too-high':
				'This went above about 300 Hz, where resonance cannot be measured: the harmonics of the voice lie too far apart to show it. A raised larynx tends to drag the pitch up with it; bring the pitch back down and keep the brightness.',
			'not-brighter':
				'The last sound did not measure brighter than your ordinary one. A small change can hide in the measure’s noise: make the difference a little bigger, keeping the vowel an “ah” and the note where it is.',
			'resonance-unsteady':
				'The resonances of one of the two sounds could not be read steadily, so they are not compared: the analysis kept flipping between two readings. It says nothing about the sound; record the take again.',
			'r1-unreadable':
				'R1 is not shown for this take: in one of the two sounds the voice was so light that the analysis finds the pitch where the first resonance should be. Nothing is wrong with the sound; the number cannot be read there.',
			'whisper-same':
				'The small position did not measure higher than the start. Begin with three seconds of your ordinary, big whisper, then let the hiss get smaller and higher; the vowel stays an “eh”.',
			aboveNote: (semitones: string) =>
				`You were about ${semitones} semitones above the note. Slide down until the marker sits on the line.`,
			belowNote: (semitones: string) =>
				`You were about ${semitones} semitones below the note. That is common at first: slide up until the marker sits on the line.`
		},
		sources: 'Sources',
		aliases: 'Also called',
		log: 'Practice log',
		logEmpty: 'No sessions yet.',
		takes: (n: number) => (n === 1 ? '1 take' : `${n} takes`),
		unfinished: 'not finished',
		single: 'One exercise',
		order: 'One take, in order',
		pause: 'pause',
		earlier: 'An earlier routine',
		needBand: 'Set your band first: the drills are judged against it.',
		needDevice: 'Add a microphone setup first.',
		band: {
			title: 'Your band',
			intro:
				'The pitch range you practise in: a workspace for finding a lighter voice, not a goal. It should sit just above your everyday voice, where a light sound is easy; higher is not better. Move it whenever you like.',
			own: (low: number, high: number) => `Use a band from your own voice: ${low}–${high} Hz`,
			reach: (semitones: string) =>
				`This band starts about ${semitones} semitones above your everyday voice. If practice feels effortful, a lower band is easier to stay light in.`,
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
			demo: 'Hear the shape',
			demoHint: 'A tone that moves the way your voice should. It is not recorded.',
			you: (pitch: string) => `You: ${pitch}`,
			youSilent: 'You: —',
			metWithEffort: 'Met, with effort',
			yourNote: (name: string) => `Your note: ${name}`,
			record: 'Record',
			try: 'Try it first',
			tryHint: 'The live guides run on the microphone; nothing is recorded or saved.',
			trying: 'Trying it: nothing is recorded.',
			doneTrying: 'Done trying',
			clipped: (n: number) =>
				`This take clipped (${n} samples at full scale): it was too loud for the microphone, so its numbers are off. Softer is also the point: the drills want an easy sound, not a loud one. Discard it and go again a little quieter, or further from the microphone.`,
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
			'too-little-whisper':
				'Too little whisper to read: it takes at least six seconds with sound in them.',
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
	player: {
		play: 'Play',
		pause: 'Pause',
		download: 'Download the recording',
		position: 'Position in the take',
		spectrogram: 'Spectrogram: frequency upwards to 5 kHz over time, with the level below',
		drawing: 'Drawing…',
		live: (seconds: number) =>
			`The last ${seconds} seconds: frequency upwards, the level below. A picture to look at, not a measurement.`,
		view: 'What the spectrogram shows',
		views: { harmonics: 'Harmonics', formants: 'Formants' },
		viewHint: {
			harmonics:
				'A long window: the separate harmonics of the voice as thin lines. Pitch is their spacing: lines further apart, a higher voice. Weight shows too: a lighter voice has fewer, fainter lines higher up.',
			formants:
				'A short window: the resonances of the throat and mouth as broad bands. Resonance is where the bands sit: a smaller space moves them up.'
		},
		problems: {
			missing: 'The recording is missing from storage.',
			unreachable: 'The recording could not be loaded: the API is not reachable.',
			undecodable: 'This browser cannot draw this recording. It can still be downloaded.'
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
