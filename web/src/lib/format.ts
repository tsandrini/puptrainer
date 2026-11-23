// Dates, durations and measurements as text, in the interface language.

import type { MetricDef } from './api/types.js';

/** The formatting locale of an interface language: English dates read day first, 24 hours. */
const formatLocale = (locale: string) => (locale === 'en' ? 'en-GB' : locale);

/** A date and time: `16 Nov 2026, 20:01`. */
export const fmtDateTime = (iso: string, locale: string) =>
	new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(iso)
	);

/** A date without its time: `16 Nov 2026`. */
export const fmtDate = (iso: string, locale: string) =>
	new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: 'medium' }).format(new Date(iso));

/** A length in seconds as `m:ss`. */
export function fmtDuration(seconds: number): string {
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A number with a fixed number of decimals and a real minus sign. */
export const fmtNumber = (value: number, decimals: number, locale: string) =>
	value
		.toLocaleString(formatLocale(locale), {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		})
		.replace('-', '−');

/** A difference with its sign: `+4.2`, `−0.3`; no sign on what rounds to zero. */
export function fmtSigned(value: number, decimals: number, locale: string): string {
	const text = fmtNumber(Math.abs(value), decimals, locale);
	if (Number(Math.abs(value).toFixed(decimals)) === 0) return text;
	return (value > 0 ? '+' : '−') + text;
}

/** A measurement with its unit: `159 Hz`. */
export function fmtMetric(value: number, metric: MetricDef, locale: string): string {
	const text = fmtNumber(value, metric.decimals, locale);
	return metric.unit ? `${text} ${metric.unit}` : text;
}

/** `<input type="datetime-local">` value for a moment, in local time. */
export function toLocalInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}
