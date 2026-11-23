import { describe, expect, it } from 'vitest';
import {
	barsOption,
	calendarOption,
	matrixOption,
	scatterOption,
	spreadOption,
	trendOption,
	type Line,
	type Palette,
	type Panel
} from './options.js';

const palette: Palette = {
	text: '#111',
	muted: '#777',
	grid: '#eee',
	border: '#ddd',
	card: '#fff',
	popover: '#fff',
	series: ['#01', '#02', '#03', '#04', '#05', '#06'],
	good: '#0a0',
	warning: '#a80',
	primary: '#c07',
	soft: 'rgba(200,0,100,.1)',
	font: 'sans'
};
const DAY = 86_400_000;
const T0 = new Date(2026, 10, 20, 9).getTime();
const frame = { full: false, height: 400 };

const line = (voice: Line['voice'], values: number[], name = 'Brightness'): Line => ({
	key: `b:${voice}`,
	name,
	color: palette.series[1],
	voice,
	dots: values.map((value, index) => ({
		id: `${voice}${index}`,
		at: T0 + index * 3_600_000,
		value
	}))
});
const brightness: Panel = {
	key: 'brightness',
	title: 'Brightness',
	unit: '%',
	signed: true,
	zones: [
		{ low: 10, high: 23, label: 'where women’s voices sit', tone: 'good' },
		{ low: 23, high: null, label: 'children’s voices', tone: 'warning' }
	],
	lines: [line('attempt', [6, 8, 7]), line('habitual', [0.5, -1])]
};
type Series = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const seriesOf = (option: { series?: unknown }) => option.series as Series[];

describe('takes over time', () => {
	const option = trendOption({ panels: [brightness], palette, frame, locale: 'en', legend: true });
	const series = seriesOf(option);
	const find = (id: string) => series.find((s) => s.id === id)!;

	it('draws an attempt solid and filled, the everyday voice dashed and hollow', () => {
		const [attempt, everyday] = [find('brightness:b:attempt'), find('brightness:b:habitual')];
		expect(attempt.lineStyle.type).toBe('solid');
		expect(attempt.itemStyle.color).toBe(palette.series[1]);
		expect(everyday.lineStyle.type).toEqual([6, 4]);
		expect(everyday.itemStyle).toMatchObject({
			color: palette.card,
			borderColor: palette.series[1]
		});
	});

	it('gives every point its take', () => {
		expect(find('brightness:b:attempt').data.map((d: Series) => d.take)).toEqual([
			'attempt0',
			'attempt1',
			'attempt2'
		]);
	});

	it('names the reference ranges and lets the axis reach the first of them', () => {
		const areas = find('brightness:ground').markArea.data as Series[][];
		expect(areas.map((area) => area[0].name)).toEqual([
			'where women’s voices sit',
			'children’s voices'
		]);
		const axis = (option.yAxis as Series[])[0];
		expect(axis.max).toBeGreaterThan(10);
		// the open end of the upper range stops at the axis
		expect(areas[1][1].yAxis).toBe(axis.max);
		expect(axis.min).toBeLessThan(-1);
	});

	it('lists a measure once in the legend, in its own hue', () => {
		const legend = option.legend as Series;
		expect(legend.data).toEqual([
			{ name: 'Brightness', itemStyle: { color: palette.series[1], borderWidth: 0 } }
		]);
	});

	it('marks the take in the player, and draws lines before what lies behind them', () => {
		const marked = trendOption({ panels: [brightness], palette, frame, locale: 'en', mark: T0 });
		const all = seriesOf(marked);
		const ground = all.find((s) => s.id === 'brightness:ground')!;
		expect(ground.markLine.data.some((d: Series) => d.xAxis === T0)).toBe(true);
		expect(all[0].id).toBe('brightness:b:attempt');
		expect(all.at(-1)!.id).toBe('brightness:ground');
	});

	it('leaves a panel without takes out', () => {
		const empty: Panel = { key: 'r1', title: 'R1', unit: '%', lines: [] };
		const both = trendOption({ panels: [brightness, empty], palette, frame, locale: 'en' });
		expect(both.grid).toHaveLength(1);
	});

	it('per day: the median at noon, the range as a whisker, the takes kept', () => {
		const spread: Panel = {
			...brightness,
			zones: [],
			lines: [
				{
					...line('attempt', []),
					dots: [
						{ id: 'a', at: T0, value: 4 },
						{ id: 'b', at: T0 + 3_600_000, value: 10 },
						{ id: 'c', at: T0 + 7_200_000, value: 6 },
						{ id: 'd', at: T0 + DAY, value: 9 }
					]
				}
			]
		};
		const daily = trendOption({ panels: [spread], palette, frame, locale: 'en', by: 'day' });
		const all = seriesOf(daily);
		const medians = all.find((s) => s.id === 'brightness:b:attempt')!;
		const noon = new Date(2026, 10, 20, 12).getTime();
		expect(medians.data[0]).toEqual({ value: [noon, 6], takes: ['a', 'b', 'c'] });
		expect(medians.data[1].value[1]).toBe(9);
		// one whisker: a day with one take has no range
		expect(all.find((s) => s.id === 'brightness:b:attempt:range')!.data).toEqual([[noon, 4, 10]]);
		const axis = (daily.xAxis as Series[])[0];
		expect(axis.min).toBeLessThan(noon);
	});

	it('shows a bar an exercise sets, and colours a point by whether it met it', () => {
		const drill: Panel = {
			key: 'hold',
			title: 'Steady hold',
			unit: 's',
			bars: [{ value: 1.5, label: 'at least 1.5 s' }],
			lines: [
				{
					...line('drill', []),
					dots: [
						{ id: 'x', at: T0, value: 2, tone: 'met' },
						{ id: 'y', at: T0 + 1000, value: 1, tone: 'missed' }
					]
				}
			]
		};
		const all = seriesOf(trendOption({ panels: [drill], palette, frame, locale: 'en' }));
		const points = all.find((s) => s.id === 'hold:b:drill')!;
		expect(points.lineStyle.type).toEqual([1, 4]);
		expect(points.data[0].itemStyle.color).toBe(palette.good);
		expect(points.data[1].itemStyle.color).toBe(palette.card);
		const ground = all.find((s) => s.id === 'hold:ground')!;
		expect(ground.markLine.data[0]).toMatchObject({ yAxis: 1.5 });
	});
});

describe('two measures against each other', () => {
	const points = [
		{ id: 'e1', x: 0, y: 0, voice: 'habitual' as const },
		{ id: 'e2', x: 1, y: 1, voice: 'habitual' as const },
		{ id: 'a1', x: 6, y: 7, voice: 'attempt' as const },
		{ id: 'a2', x: 8, y: 8, voice: 'attempt' as const }
	];
	const scale = { title: 'Δ lightness', unit: 'dB', signed: true };

	it('fits a line through three takes or more, and none through fewer', () => {
		const series = seriesOf(scatterOption({ x: scale, y: scale, points, palette, locale: 'en' }));
		const fit = series.find((s) => s.id === 'fit')!;
		expect(fit.data[0][0]).toBe(0);
		expect(fit.data[1][0]).toBe(8);
		const few = seriesOf(
			scatterOption({ x: scale, y: scale, points: points.slice(0, 2), palette, locale: 'en' })
		);
		expect(few.some((s) => s.id === 'fit')).toBe(false);
	});

	it('keeps the voices apart by their marks and enlarges the take in the player', () => {
		const series = seriesOf(
			scatterOption({ x: scale, y: scale, points, palette, locale: 'en', mark: 'a2', select: true })
		);
		const attempt = series.find((s) => s.id === 'attempt')!;
		expect(attempt.itemStyle.color).toBe(palette.series[0]);
		expect(series.find((s) => s.id === 'habitual')!.itemStyle.color).toBe(palette.card);
		expect(attempt.data.map((d: Series) => d.symbolSize)).toEqual([11, 17]);
	});
});

describe('how the measures go together', () => {
	it('leaves the diagonal and the pairs without an r empty, and outlines the picked pair', () => {
		const option = matrixOption({
			names: ['a', 'b'],
			cells: [
				{ x: 0, y: 0, r: 1, n: 5 },
				{ x: 1, y: 0, r: 0.5, n: 5 },
				{ x: 0, y: 1, r: 0.5, n: 5 },
				{ x: 1, y: 1, r: null, n: 0 }
			],
			palette,
			locale: 'en',
			picked: [1, 0]
		});
		const data = seriesOf(option)[0].data as Series[];
		expect(data.map((d) => d.value.slice(0, 3))).toEqual([
			[1, 0, 0.5],
			[0, 1, 0.5]
		]);
		expect(data[0].itemStyle.borderColor).toBe(palette.text);
		expect(data[1].itemStyle.borderColor).toBe(palette.card);
	});
});

describe('how each voice spreads', () => {
	it('gives a row per voice that has takes, with the quartiles behind the points', () => {
		const dots = [1, 2, 3, 4, 5].map((value, index) => ({ id: `t${index}`, at: T0, value }));
		const option = spreadOption({
			scale: { title: 'Pitch', unit: 'st', signed: true },
			rows: [
				{ name: 'Everyday voice', voice: 'habitual', dots },
				{ name: 'Attempt', voice: 'attempt', dots: [] }
			],
			palette,
			locale: 'en'
		});
		const series = seriesOf(option);
		expect(series.find((s) => s.id === 'box')!.data).toEqual([[0, 2, 3, 4, 5]]);
		expect(series.filter((s) => s.id === 'habitual' || s.id === 'attempt')).toHaveLength(1);
		expect((option.yAxis as Series).max).toBe(0.5);
	});
});

describe('practice per day', () => {
	const days = [T0, T0 + DAY, T0 + 2 * DAY];
	const parts = [
		{ name: 'Pitch', color: palette.series[0], values: [5, 0, 7] },
		{ name: 'Resonance', color: palette.series[2], values: [0, 9, 3] }
	];

	it('stacks the parts of a day into one bar, each part in its own colour', () => {
		const option = barsOption({ days, parts, unit: 'min', palette, locale: 'en' });
		expect(
			seriesOf(option).map((s) => [s.name, s.type, s.stack, s.itemStyle.color, s.data])
		).toEqual([
			['Pitch', 'bar', 'day', '#01', [5, 0, 7]],
			['Resonance', 'bar', 'day', '#03', [0, 9, 3]]
		]);
		expect((option.xAxis as Series).data).toEqual(['20 Nov', '21 Nov', '22 Nov']);
		expect(option.legend).toBeDefined();
	});

	it('names nothing in a legend when there is one part', () => {
		const option = barsOption({
			days,
			parts: parts.slice(0, 1),
			unit: 'min',
			palette,
			locale: 'en'
		});
		expect(option.legend).toBeUndefined();
	});
});

describe('practice days as a calendar', () => {
	const option = calendarOption({
		days: [
			{ day: T0, value: 12 },
			{ day: T0 + DAY, value: 0 },
			{ day: T0 + 2 * DAY, value: 30 }
		],
		from: T0 - 7 * DAY,
		to: T0 + 2 * DAY,
		unit: 'min',
		palette,
		locale: 'en'
	});

	it('shades only the days with practice, on one hue up to the most of them', () => {
		expect(seriesOf(option)[0].data).toEqual([
			['2026-11-20', 12],
			['2026-11-22', 30]
		]);
		const map = option.visualMap as Series;
		expect([map.min, map.max]).toEqual([0, 30]);
		expect(map.inRange.color).toEqual([palette.soft, palette.primary]);
	});

	it('spans the stretch it is given, weeks from Monday', () => {
		const calendar = option.calendar as Series;
		expect(calendar.range).toEqual(['2026-11-13', '2026-11-22']);
		expect(calendar.dayLabel.firstDay).toBe(1);
	});

	it('says the day and the amount at the pointer', () => {
		const said = (option.tooltip as Series).formatter({ value: ['2026-11-20', 12] });
		expect(said).toContain('20 November 2026');
		expect(said).toContain('12 min');
	});
});
