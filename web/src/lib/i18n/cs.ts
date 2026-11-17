// Czech. Typed against the English messages: a missing or extra key fails
// the type check.

import type { Messages } from './en.js';

/** Czech has three plural forms: 1, 2–4, the rest. */
const plural = (n: number, one: string, few: string, many: string) =>
	n === 1 ? one : n >= 2 && n <= 4 ? few : many;

export const cs: Messages = {
	nav: {
		takes: 'Nahrávky',
		practice: 'Cvičení',
		record: 'Nahrát',
		progress: 'Pokrok',
		import: 'Import',
		devices: 'Mikrofony'
	},
	theme: { label: 'Vzhled', system: 'Podle systému', light: 'Světlý', dark: 'Tmavý' },
	groups: {
		recording: 'Nahrávka',
		pitch: 'Výška hlasu',
		resonance: 'Rezonance',
		quality: 'Kvalita hlasu',
		range: 'Rozsah'
	},
	common: {
		save: 'Uložit',
		cancel: 'Zrušit',
		delete: 'Smazat',
		edit: 'Upravit',
		retry: 'Zkusit znovu',
		discard: 'Zahodit',
		loading: 'Načítání…',
		none: '—',
		language: 'Jazyk',
		anyLanguage: 'bez jazyka',
		install: 'Nainstalovat aplikaci',
		showValues: 'Zobrazit hodnoty',
		hideValues: 'Skrýt hodnoty'
	},
	status: {
		apiDown: 'API není dostupné. Nahrávky zůstávají v tomto zařízení, dokud se nevrátí.',
		workerDown: 'Analýza neběží: nahrávky jsou uložené, čísla doplníme později.',
		queued: (n) =>
			`${n} ${plural(n, 'nahrávka čeká', 'nahrávky čekají', 'nahrávek čeká')} na odeslání`,
		practiceQueued: 'Sezení cvičení čeká na odeslání.'
	},
	item: {
		vowels: 'Držené samohlásky',
		glide: 'Klouzání výšky',
		sustain: 'Držený zvuk',
		phrase: 'Krátká věta',
		passage: 'Čtení',
		free: 'Volná řeč',
		other: 'Jiné'
	},
	intent: {
		label: 'Hlas',
		habitual: 'Běžný hlas',
		attempt: 'Pokus',
		drill: 'Cvičný zvuk',
		habitualHint: 'Jak mluvíte, když se nesnažíte nic měnit.',
		attemptHint: 'Váš nejlepší současný pokus o hlas, který trénujete.',
		drillHint: 'Zvuk vytvořený pro cvičení, ne hlas.'
	},
	languages: { en: 'angličtina', cs: 'čeština' },
	analysis: {
		pending: 'Čeká na analýzu',
		claimed: 'Analyzuje se',
		done: 'Analyzováno',
		failed: 'Analýza selhala',
		none: 'Bez analýzy',
		again: 'Analyzovat znovu'
	},
	takes: {
		title: 'Nahrávky',
		empty: 'Zatím žádné nahrávky. Nahrajte první, nebo importujte existující soubory.',
		emptyFiltered: 'Těmto filtrům neodpovídá žádná nahrávka.',
		recorded: 'Nahráno',
		what: 'Co',
		device: 'Mikrofon',
		duration: 'Délka',
		pitch: 'Výška',
		status: 'Analýza',
		allItems: 'Všechno',
		allIntents: 'Jakýkoli hlas',
		allLanguages: 'Jakýkoli jazyk',
		select: 'Vybrat k porovnání',
		compare: 'Porovnat',
		compareHint: 'Zaškrtněte dvě nahrávky, které chcete porovnat.',
		outdated: (n) =>
			`${n} ${plural(n, 'nahrávka byla analyzována', 'nahrávky byly analyzovány', 'nahrávek bylo analyzováno')} starší verzí analýzy.`,
		reanalyse: 'Analyzovat znovu'
	},
	take: {
		notFound: 'Tato nahrávka neexistuje.',
		labels: 'Popis',
		note: 'Poznámka',
		metrics: 'Měření',
		noMetrics: 'Zatím žádná měření.',
		file: 'Soubor',
		original: 'Původní název',
		format: (rate, channels) =>
			`${String(rate / 1000).replace('.', ',')} kHz, ${channels === 1 ? 'mono' : `${channels} kanály`}, FLAC`,
		pipeline: (version) => `verze analýzy ${version}`,
		passage: 'Čtený text',
		confirmDelete: 'Smazat tuto nahrávku i s jejím záznamem? Nelze to vrátit.',
		saved: 'Uloženo',
		contour: 'Výška hlasu v průběhu nahrávky',
		contourBand: 'Vybarvené pásmo je 145–185 Hz.',
		contourTarget: (low, high) =>
			`Vybarvené pásmo je vaše pásmo v době nahrávání: ${low}–${high} Hz.`,
		time: 'Čas',
		vowels: 'Samohlásky jednotlivě',
		vowel: 'Samohláska',
		pitch: 'Výška',
		heldFor: 'Délka',
		segments: 'Podržené zvuky jednotlivě',
		exercise: 'Cvičení',
		session: 'Sezení',
		comfort: 'Pohodlí'
	},
	progress: {
		title: 'Pokrok',
		intro:
			'Jeden bod za každou nahrávku. Porovnávejte srovnatelné: vždy jedno nastavení mikrofonu a jeden druh nahrávky.',
		empty: 'Těmto filtrům zatím neodpovídá žádná analyzovaná nahrávka.',
		kind: 'Druh nahrávky',
		latest: 'poslední',
		taken: 'Nahráno',
		withPractice: 'Zahrnout pokusy ze sezení cvičení'
	},
	compare: {
		title: 'Porovnání dvou nahrávek',
		pick: 'Zaškrtněte v seznamu dvě nahrávky a zvolte Porovnat.',
		back: 'Zpět na nahrávky',
		metric: 'Měření',
		difference: 'B − A',
		setups:
			'Nahrávky pocházejí z různých nastavení mikrofonu: rozdíly v rezonanci, sklonu a úrovni mohou být dané nastavením, ne hlasem.',
		kinds: 'Nahrávky jsou různého druhu: porovnat lze jen některá měření.'
	},
	record: {
		title: 'Nahrát',
		needDevice: 'Nejdřív přidejte mikrofon, aby se nahrávky daly později rozlišit.',
		addDevice: 'Přidat mikrofon',
		setup: 'Mikrofon',
		input: 'Vstup',
		defaultInput: 'Výchozí vstup systému',
		what: 'Co nahrát',
		start: 'Začít nahrávat',
		stop: 'Zastavit',
		recording: 'Nahrává se',
		level: 'Úroveň',
		target: 'nejhlasitější místa mají být mezi −12 a −6 dBFS',
		tooQuiet: 'Příliš tiché: zvyšte zisk nebo dejte mikrofon blíž.',
		clipping: 'Přebuzení: snižte zisk.',
		pitch: 'Výška hlasu (živě, jen orientačně)',
		review: 'Kontrola',
		peak: (db) => `špička ${db} dBFS`,
		clipped: (n) =>
			`${n} ${plural(n, 'přebuzený vzorek', 'přebuzené vzorky', 'přebuzených vzorků')}: nahrajte znovu s nižším ziskem.`,
		saveTake: 'Uložit nahrávku',
		again: 'Nahrát znovu',
		saved: 'Uloženo. Analýza proběhne za chvíli.',
		savedOffline: 'Uloženo v tomto zařízení; odešle se, až bude API dostupné.',
		denied: 'Prohlížeč odmítl přístup k mikrofonu. Povolte ho pro tuto stránku a zkuste to znovu.',
		noMic: 'Nenašel se žádný mikrofon.',
		insecure: 'Nahrávání vyžaduje zabezpečenou stránku (https nebo localhost).',
		failed: (why) => `Nahrávání selhalo: ${why}`,
		baseline: 'Výchozí stav',
		baselineToday: (done, total) => `dnes nahráno ${done} z ${total}`,
		recordedToday: 'dnes nahráno'
	},
	import: {
		title: 'Import nahrávek',
		intro:
			'Soubory WAV nebo FLAC. Názvy jako 2026-11-16_passage-en_habitual.wav vyplní popis samy.',
		choose: 'Vybrat soubory',
		file: 'Soubor',
		date: 'Nahráno',
		importAll: (n) => `Importovat ${n} ${plural(n, 'soubor', 'soubory', 'souborů')}`,
		done: (n) =>
			`${n} ${plural(n, 'soubor zařazen', 'soubory zařazeny', 'souborů zařazeno')} k odeslání.`,
		remove: 'Odebrat'
	},
	devices: {
		title: 'Mikrofony',
		intro:
			'Jeden záznam pro každé uspořádání: mikrofon a jeho umístění. Nahrávky se porovnávají jen v rámci jednoho uspořádání.',
		name: 'Název',
		kind: 'Druh',
		note: 'Poznámky k umístění',
		notePlaceholder: 'Kde je umístěn, zisk, místnost',
		add: 'Přidat mikrofon',
		empty: 'Zatím žádné mikrofony.',
		kinds: {
			lavalier: 'Klopový',
			headset: 'Náhlavní souprava',
			desktop: 'Stolní mikrofon',
			laptop: 'Notebook',
			phone: 'Telefon',
			other: 'Jiný'
		}
	},
	practice: {
		title: 'Cvičení',
		intro:
			'Krátká vedená sezení: pár cvičení a pak řeč. Výška je tu nástroj, ne skóre; jde o lehký, nenamáhavý hlas.',
		sessions: 'Sezení',
		minutes: (n) => `asi ${n} min`,
		start: 'Začít',
		catalogue: 'Katalog cvičení',
		alone: 'Procvičit samostatně',
		why: 'Proč',
		safety: 'Kdy přestat',
		sources: 'Zdroje',
		aliases: 'Také se říká',
		log: 'Deník cvičení',
		logEmpty: 'Zatím žádná sezení.',
		takes: (n) => `${n} ${plural(n, 'nahrávka', 'nahrávky', 'nahrávek')}`,
		unfinished: 'nedokončeno',
		single: 'Jedno cvičení',
		needBand: 'Nejdřív nastavte své pásmo: cvičení se posuzují podle něj.',
		needDevice: 'Nejdřív přidejte nastavení mikrofonu.',
		band: {
			title: 'Vaše pásmo',
			intro:
				'Rozsah výšky, ve kterém cvičíte. Je to tréninkový nástroj, který si volíte a můžete ho kdykoli posunout; čísla v materiálech učitelů jsou zvyklosti, ne cíle.',
			none: 'Pásmo zatím není nastavené.',
			low: 'Od (Hz)',
			high: 'Do (Hz)',
			set: 'Nastavit pásmo',
			starting: 'Použít běžné výchozí pásmo: F3–A3, 174–220 Hz',
			conventions:
				'Wiki Sumian Voice používá jako tréninkovou výšku asi 200 Hz (G3); kurz Scinguistics míří na F3 až A3.',
			glide: (low, high) => `Poslední klouzání vedlo od ${low} do ${high}.`,
			everyday: (hz) => `Váš běžný hlas: medián ${hz}.`,
			invalid: 'Horní hranice musí ležet aspoň o půltón nad dolní.'
		},
		run: {
			checkin: 'Jak se dnes cítí váš hlas?',
			feel: {
				fresh: 'Svěží',
				normal: 'Normálně',
				tired: 'Unavený',
				hoarse: 'Chraptivý nebo bolavý'
			},
			hoarse:
				'Chraptivý nebo bolavý hlas potřebuje odpočinek, ne cvičení. Dnes odpočívejte a zkuste to zítra.',
			rest: 'Dnes odpočinek',
			gently: 'Pokračovat, opatrně',
			language: 'Jazyk mluvených kroků',
			begin: 'Začít',
			skip: 'Přeskočit',
			step: (i, n) => `Cvičení ${i} z ${n}`,
			rep: (i, n) => `opakování ${i} z ${n}`,
			playNote: 'Přehrát tón',
			yourNote: (name) => `Váš tón: ${name}`,
			record: 'Nahrávat',
			stop: 'Stop',
			listen: 'Poslechnout si',
			comfort: 'Jak se vám to dělalo?',
			comforts: ['S napětím', 'Namáhavě', 'Ujde to', 'Pohodlně', 'Bez námahy'],
			measuring: 'Měří se…',
			offline: 'Uloženo v tomto zařízení; změří se, až bude aplikace zase dostupná.',
			met: 'Splněno',
			notYet: 'Zatím ne',
			hint: 'vodítko',
			hintNote: 'Vodítko, ne hodnocení: jak moc mu věřit, říká stránka měření.',
			next: 'Další opakování',
			nextStep: (title) => `Dál: ${title}`,
			toCheckout: 'Dokončit',
			skipStep: 'Přeskočit toto cvičení',
			end: 'Ukončit sezení',
			strained: 'Napětí je signál přestat. Odpočiňte si a příště to zkuste lehčeji nebo níž.',
			strainedNext: 'Přejít na další cvičení',
			strainedRetry: 'Zkusit ještě jednou, lehčeji',
			effortful: 'Namáhavé: zkuste to lehčeji, nebo o kousek níž.',
			strainedResult: 'Čísla vyšla, ale s napětím, takže se to nepočítá: příště lehčeji nebo níž.',
			checkout: 'Jaké bylo sezení jako celek?',
			tension: 'Trvalo nějaké napětí v krku nebo na šíji i po skončení?',
			yes: 'Ano',
			no: 'Ne',
			tensionAdvice: 'Přetrvávající napětí znamená odpočinek: dnes už žádné hlasové cvičení.',
			note: 'Poznámka',
			finish: 'Uložit sezení',
			done: 'Sezení je uložené.',
			summary: (takes, met) => `Nahrávky: ${takes}, splněno: ${met}.`,
			toLog: 'Otevřít v deníku',
			back: 'Zpět na cvičení'
		},
		problems: {
			'not-analysed': 'Zatím nezměřeno.',
			'no-band': 'K této nahrávce nebylo nastavené pásmo.',
			'no-note': 'K této nahrávce nezazněl žádný tón.',
			'too-little-voice': 'Příliš málo hlasu na posouzení.',
			'not-measured': 'Na této nahrávce se to nedalo změřit.',
			'unknown-exercise': 'Toto cvičení už v katalogu není.'
		},
		session: {
			title: 'Sezení cvičení',
			feel: 'Na začátku',
			comfort: 'Celkové pohodlí',
			tension: 'Přetrvávající napětí',
			notFound: 'Toto sezení neexistuje.',
			confirmDelete: 'Smazat toto sezení z deníku? Jeho nahrávky zůstanou.'
		}
	},
	login: {
		title: 'Přihlášení',
		prompt: 'Tento puptrainer vyžaduje přístupový token.',
		token: 'Přístupový token',
		submit: 'Přihlásit se',
		wrong: 'Tento token nebyl přijat.',
		signOut: 'Odhlásit se'
	},
	queue: {
		title: 'Čeká na odeslání',
		rejected: 'API soubor odmítlo',
		practice: 'Sezení cvičení'
	}
};
