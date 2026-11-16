// Czech. Typed against the English messages: a missing or extra key fails
// the type check.

import type { Messages } from './en.js';

/** Czech has three plural forms: 1, 2–4, the rest. */
const plural = (n: number, one: string, few: string, many: string) =>
	n === 1 ? one : n >= 2 && n <= 4 ? few : many;

export const cs: Messages = {
	nav: { takes: 'Nahrávky', record: 'Nahrát', import: 'Import', devices: 'Mikrofony' },
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
		install: 'Nainstalovat aplikaci'
	},
	status: {
		apiDown: 'API není dostupné. Nahrávky zůstávají v tomto zařízení, dokud se nevrátí.',
		workerDown: 'Analýza neběží: nahrávky jsou uložené, čísla doplníme později.',
		queued: (n) =>
			`${n} ${plural(n, 'nahrávka čeká', 'nahrávky čekají', 'nahrávek čeká')} na odeslání`
	},
	item: {
		vowels: 'Držené samohlásky',
		glide: 'Klouzání výšky',
		passage: 'Čtení',
		free: 'Volná řeč',
		other: 'Jiné'
	},
	intent: {
		label: 'Hlas',
		habitual: 'Běžný hlas',
		attempt: 'Pokus',
		habitualHint: 'Jak mluvíte, když se nesnažíte nic měnit.',
		attemptHint: 'Váš nejlepší současný pokus o hlas, který trénujete.'
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
		pitch: 'Medián výšky',
		status: 'Analýza',
		allItems: 'Všechno',
		allIntents: 'Jakýkoli hlas',
		allLanguages: 'Jakýkoli jazyk'
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
		saved: 'Uloženo'
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
		failed: (why) => `Nahrávání selhalo: ${why}`
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
	queue: {
		title: 'Čeká na odeslání',
		rejected: 'API soubor odmítlo'
	}
};
