// The Progress page's charts as ECharts options: pure functions from shaped
// data and the theme's colours, so they can be tested without a browser.
//
// The conventions every chart here keeps:
// - a hue says which measure; where one chart has one measure it is the first hue;
// - the voice is the line and the mark: an attempt solid and filled, the
//   everyday voice dashed and hollow, a drill dotted;
// - a reference range is drawn and named wherever the measure has one;
// - a point is a take: its `take` goes with the datum, for the tooltip and the click.
import type { EChartsOption, SeriesOption } from 'echarts';
import type { Voice } from '#lib/charts.js';
import { byDay, extent, fitLine, median, quantile } from '#lib/stats.js';

/** The theme's colours, resolved to something a canvas reads. */
export type Palette = {
	text: string;
	muted: string;
	grid: string;
	border: string;
	card: string;
	popover: string;
	/** The six series hues, in the theme's order. */
	series: string[];
	good: string;
	warning: string;
	primary: string;
	/** The primary colour as a wash, for a selection. */
	soft: string;
	font: string;
};

export type Style = Voice | 'drill';
/** One take on a chart. */
export type Dot = { id: string; at: number; value: number; tone?: 'met' | 'missed' };
/** One line of a panel: a measure in one voice. */
export type Line = { key: string; name: string; color: string; voice: Style; dots: Dot[] };
/** A reference range on a value axis; an open end reaches to the axis's. */
export type ZoneBand = {
	low: number | null;
	high: number | null;
	label: string;
	tone: 'good' | 'warning' | 'band';
};
/** A line across a panel: the bar an exercise sets. */
export type Bar = { value: number; label: string };
/** One grid of a chart over time. */
export type Panel = {
	key: string;
	title: string;
	unit: string;
	lines: Line[];
	zones?: ZoneBand[];
	bars?: Bar[];
	/** Values are distances: zero is drawn and numbers carry their sign. */
	signed?: boolean;
	/** The least the value axis spans, so that nothing small is blown up. */
	least?: number;
	/** Its share of the height beside the other panels. */
	weight?: number;
};
/** Where a chart is drawn: in its card, or over the whole screen. */
export type Frame = { full: boolean; height: number };
/** What a tooltip is made from: a take, or the takes of a day. */
export type Datum = { take?: string; takes?: string[]; value: unknown };
export type Tip = (datum: Datum) => HTMLElement | string;

const DAY = 86_400_000;
const DASH: Record<Style, number[] | 'solid'> = {
	attempt: 'solid',
	habitual: [6, 4],
	drill: [1, 4]
};
const TONE = { good: 0.13, warning: 0.13, band: 0.1 } as const;

const toneColor = (palette: Palette, tone: ZoneBand['tone']) =>
	tone === 'band' ? palette.primary : palette[tone];

/** A number as an axis says it. */
const number = (locale: string, signed = false) => {
	const format = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale, {
		maximumFractionDigits: 2,
		signDisplay: signed ? 'exceptZero' : 'auto'
	});
	return (value: number) => format.format(value);
};

/** The mark of a voice: filled for an attempt, hollow for the everyday voice. */
function mark(palette: Palette, color: string, voice: Style) {
	return voice === 'habitual'
		? { color: palette.card, borderColor: color, borderWidth: 2 }
		: { color, borderColor: palette.card, borderWidth: 1 };
}

function tooltip(palette: Palette, tip: Tip | undefined): EChartsOption['tooltip'] {
	return {
		trigger: 'item',
		confine: true,
		show: Boolean(tip),
		backgroundColor: palette.popover,
		borderColor: palette.border,
		borderWidth: 1,
		padding: 10,
		textStyle: { color: palette.text, fontSize: 12, fontFamily: palette.font },
		extraCssText: 'border-radius:10px;box-shadow:0 8px 24px -12px rgb(0 0 0/.35);max-width:24rem;',
		formatter: (params) => tip?.((Array.isArray(params) ? params[0] : params).data as Datum) ?? ''
	};
}

/** Zones as shaded areas of a series that has nothing else to show. */
function zoneAreas(palette: Palette, zones: ZoneBand[], axis: 'x' | 'y', ends: [number, number]) {
	const key = axis === 'x' ? 'xAxis' : 'yAxis';
	return zones
		.map((zone) => ({
			zone,
			low: Math.max(zone.low ?? ends[0], ends[0]),
			high: Math.min(zone.high ?? ends[1], ends[1])
		}))
		.filter(({ low, high }) => high > low)
		.map(({ zone, low, high }) => [
			{
				[key]: low,
				name: zone.label,
				itemStyle: { color: toneColor(palette, zone.tone), opacity: TONE[zone.tone] },
				label: {
					show: true,
					position: axis === 'x' ? 'insideTop' : 'insideTopRight',
					color: palette.muted,
					fontSize: 10,
					fontFamily: palette.font,
					distance: 3
				}
			},
			{ [key]: high }
		]);
}

/**
 * Takes over time, in one grid per panel on one time axis.
 *
 * @param input.by A point per take, or per day (its median, with the day's range as a whisker).
 * @param input.mark A moment to mark in every panel: the take in the player.
 * @param input.slider A slider under the chart that shows the whole stretch and the part in view.
 * @param input.legend The measures as a legend that switches them, for a chart of several.
 */
export function trendOption(input: {
	panels: Panel[];
	palette: Palette;
	frame: Frame;
	locale: string;
	by?: 'take' | 'day';
	mark?: number | null;
	slider?: boolean;
	legend?: boolean;
	tip?: Tip;
}): EChartsOption {
	const {
		palette,
		frame,
		locale,
		by = 'take',
		mark: marked = null,
		slider = false,
		legend = false
	} = input;
	const panels = input.panels.filter((panel) => panel.lines.some((line) => line.dots.length));
	const text = { color: palette.muted, fontSize: 11, fontFamily: palette.font };

	// where the grids sit: the legend above, the time labels and the slider below
	const named = panels.some((panel) => panel.title || panel.unit);
	const top = (legend ? 26 : 0) + (named ? 26 : 12);
	const bottom = slider ? 66 : 30;
	const gap = 34;
	const room = Math.max(
		frame.height - top - bottom - gap * (panels.length - 1),
		60 * panels.length
	);
	const weights = panels.map((panel) => panel.weight ?? 1);
	const whole = weights.reduce((sum, weight) => sum + weight, 0) || 1;
	let cursor = top;
	const boxes = weights.map((weight) => {
		const height = (room * weight) / whole;
		const box = { top: Math.round(cursor), height: Math.round(height) };
		cursor += height + gap;
		return box;
	});

	// NOTE: per day a point sits at the day's noon: the axis has to reach it
	const times = panels.flatMap((panel) =>
		panel.lines.flatMap((line) =>
			by === 'day'
				? byDay(line.dots, (d) => d.at).map(({ day }) => day + DAY / 2)
				: line.dots.map((d) => d.at)
		)
	);
	const [first, last] = times.length ? [Math.min(...times), Math.max(...times)] : [0, DAY];
	const margin = last > first ? (last - first) * 0.03 : DAY / 2;
	const all = panels.map((_, index) => index);

	const series: SeriesOption[] = [];
	const grounds: SeriesOption[] = [];
	const names: { name: string; color: string }[] = [];
	const ends: [number, number][] = [];

	panels.forEach((panel, index) => {
		const values = panel.lines.flatMap((line) => line.dots.map((d) => d.value));
		const reach = (panel.zones ?? [])
			.filter((zone) => zone.low !== null)
			.map((zone) => zone.low! + ((zone.high ?? zone.low! * 1.5) - zone.low!) / 4);
		const range = extent(values, {
			include: [
				...(panel.signed ? [0] : []),
				...reach,
				...(panel.bars ?? []).map((bar) => bar.value)
			],
			least: panel.least ?? 0
		});
		ends.push(range);

		// what is behind the lines: the ranges, zero, the bars, the take in the player
		grounds.push({
			id: `${panel.key}:ground`,
			z: 1,
			type: 'line',
			xAxisIndex: index,
			yAxisIndex: index,
			data: [],
			silent: true,
			tooltip: { show: false },
			markArea: { silent: true, data: zoneAreas(palette, panel.zones ?? [], 'y', range) },
			markLine: {
				silent: true,
				symbol: 'none',
				animation: false,
				data: [
					...(panel.signed
						? [
								{
									yAxis: 0,
									lineStyle: { color: palette.border, width: 1, type: 'solid' as const },
									label: { show: false }
								}
							]
						: []),
					...(panel.bars ?? []).map((bar) => ({
						yAxis: bar.value,
						lineStyle: { color: palette.good, width: 1, type: [4, 3] },
						label: {
							show: true,
							formatter: bar.label,
							position: 'insideEndTop' as const,
							color: palette.good,
							fontSize: 10,
							fontFamily: palette.font
						}
					})),
					...(marked !== null
						? [
								{
									xAxis: marked,
									lineStyle: {
										color: palette.text,
										width: 1.5,
										type: 'solid' as const,
										opacity: 0.75
									},
									label: { show: false }
								}
							]
						: [])
				]
			}
		} as SeriesOption);

		for (const line of panel.lines) {
			if (!line.dots.length) continue;
			if (!names.some((entry) => entry.name === line.name))
				names.push({ name: line.name, color: line.color });
			const look = {
				lineStyle: {
					color: line.color,
					width: 2,
					type: DASH[line.voice],
					opacity: line.voice === 'attempt' ? 1 : 0.8
				},
				itemStyle: mark(palette, line.color, line.voice)
			};
			const shared = {
				name: line.name,
				type: 'line' as const,
				xAxisIndex: index,
				yAxisIndex: index,
				symbol: line.voice === 'drill' ? 'diamond' : 'circle',
				symbolSize: 9,
				showSymbol: true,
				connectNulls: true,
				z: line.voice === 'attempt' ? 4 : 3,
				emphasis: { scale: 1.6, focus: 'none' as const },
				...look
			};
			if (by === 'take') {
				series.push({
					...shared,
					id: `${panel.key}:${line.key}`,
					data: line.dots.map((dot) => ({
						value: [dot.at, dot.value],
						take: dot.id,
						...(dot.tone
							? {
									itemStyle:
										dot.tone === 'met'
											? { color: palette.good, borderColor: palette.card, borderWidth: 1 }
											: { color: palette.card, borderColor: palette.muted, borderWidth: 2 }
								}
							: {})
					}))
				} as SeriesOption);
				continue;
			}
			const days = byDay(line.dots, (dot) => dot.at);
			series.push({
				...shared,
				id: `${panel.key}:${line.key}`,
				data: days.map(({ day, items }) => ({
					value: [day + DAY / 2, median(items.map((d) => d.value))],
					takes: items.map((d) => d.id)
				}))
			} as SeriesOption);
			series.push({
				id: `${panel.key}:${line.key}:range`,
				name: line.name,
				type: 'custom',
				xAxisIndex: index,
				yAxisIndex: index,
				silent: true,
				tooltip: { show: false },
				z: 2,
				encode: { x: 0, y: [1, 2] },
				data: days
					.filter(({ items }) => items.length > 1)
					.map(({ day, items }) => [
						day + DAY / 2,
						Math.min(...items.map((d) => d.value)),
						Math.max(...items.map((d) => d.value))
					]),
				renderItem: (_params, api) => {
					const from = api.coord([api.value(0), api.value(1)]);
					const to = api.coord([api.value(0), api.value(2)]);
					return {
						type: 'line',
						shape: { x1: from[0], y1: from[1], x2: to[0], y2: to[1] },
						style: { stroke: line.color, lineWidth: 5, opacity: 0.28, lineCap: 'round' }
					};
				}
			} as SeriesOption);
		}
	});

	const stamp = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	return {
		animationDuration: 250,
		textStyle: { fontFamily: palette.font },
		tooltip: tooltip(palette, input.tip),
		axisPointer: { link: [{ xAxisIndex: 'all' }] },
		legend: legend
			? {
					type: 'scroll',
					top: 0,
					left: 0,
					itemWidth: 14,
					itemHeight: 8,
					itemGap: 14,
					icon: 'roundRect',
					textStyle: text,
					inactiveColor: palette.border,
					itemStyle: { borderWidth: 0 },
					lineStyle: { width: 0 },
					data: names.map((entry) => ({
						name: entry.name,
						itemStyle: { color: entry.color, borderWidth: 0 }
					}))
				}
			: undefined,
		grid: boxes.map((box) => ({ left: 56, right: 18, ...box })),
		xAxis: panels.map((_, index) => ({
			type: 'time' as const,
			gridIndex: index,
			min: first - margin,
			max: last + margin,
			axisLine: { lineStyle: { color: palette.border } },
			axisTick: { show: false },
			splitLine: { show: true, lineStyle: { color: palette.grid } },
			axisLabel: {
				...text,
				show: index === panels.length - 1,
				hideOverlap: true,
				formatter: {
					year: '{yyyy}',
					month: '{MMM} {yyyy}',
					day: '{d} {MMM}',
					hour: '{HH}:{mm}',
					minute: '{HH}:{mm}',
					second: '{HH}:{mm}:{ss}',
					millisecond: '{HH}:{mm}:{ss}',
					none: '{d} {MMM}'
				}
			},
			axisPointer: {
				show: true,
				snap: false,
				triggerTooltip: false,
				lineStyle: { color: palette.muted, width: 1, type: [3, 3] },
				label: {
					show: index === panels.length - 1,
					backgroundColor: palette.text,
					color: palette.card,
					fontSize: 10,
					fontFamily: palette.font,
					formatter: (params: { value: unknown }) => stamp.format(new Date(Number(params.value)))
				}
			}
		})),
		yAxis: panels.map((panel, index) => ({
			type: 'value' as const,
			gridIndex: index,
			min: ends[index][0],
			max: ends[index][1],
			name:
				panel.unit && panel.title ? `${panel.title} (${panel.unit})` : panel.title || panel.unit,
			nameLocation: 'end' as const,
			nameGap: 9,
			nameTextStyle: {
				align: 'left' as const,
				padding: [0, 0, 0, -48],
				color: palette.text,
				fontSize: 11.5,
				fontWeight: 700 as const,
				fontFamily: palette.font
			},
			axisLine: { show: false },
			axisTick: { show: false },
			splitNumber: boxes[index].height < 110 ? 2 : 4,
			splitLine: { lineStyle: { color: palette.grid } },
			axisLabel: {
				...text,
				formatter: number(locale, panel.signed),
				showMinLabel: false,
				showMaxLabel: false
			}
		})),
		dataZoom: [
			{
				type: 'inside',
				xAxisIndex: all,
				filterMode: 'none',
				// NOTE: a bare wheel scrolls the page; over the whole screen there is no page to scroll
				zoomOnMouseWheel: frame.full ? true : 'ctrl',
				moveOnMouseWheel: false,
				moveOnMouseMove: true
			},
			...(slider
				? [
						{
							type: 'slider' as const,
							xAxisIndex: all,
							filterMode: 'none' as const,
							height: 22,
							bottom: 6,
							borderColor: palette.border,
							backgroundColor: 'transparent',
							fillerColor: palette.soft,
							dataBackground: {
								lineStyle: { color: palette.muted, opacity: 0.6 },
								areaStyle: { color: palette.muted, opacity: 0.12 }
							},
							selectedDataBackground: {
								lineStyle: { color: palette.primary },
								areaStyle: { color: palette.primary, opacity: 0.2 }
							},
							handleStyle: { color: palette.card, borderColor: palette.muted },
							moveHandleStyle: { color: palette.muted, opacity: 0.4 },
							textStyle: { ...text, fontSize: 10 },
							labelFormatter: (value: number) => stamp.format(new Date(value)),
							brushSelect: true
						}
					]
				: [])
		],
		// NOTE: the lines first: the slider draws its overview from the first series
		series: [...series, ...grounds]
	};
}

/** One axis of a chart of two measures. */
export type Scale = { title: string; unit: string; signed?: boolean; zones?: ZoneBand[] };
export type Pair = { id: string; x: number; y: number; voice: Voice };

/**
 * Two measures against each other, a point per take, with their straight-line fit.
 *
 * @param input.mark The take in the player: drawn larger.
 * @param input.select Offer a rectangle to select takes with.
 */
export function scatterOption(input: {
	x: Scale;
	y: Scale;
	points: Pair[];
	palette: Palette;
	locale: string;
	mark?: string | null;
	select?: boolean;
	tip?: Tip;
}): EChartsOption {
	const { palette, locale, points, x, y } = input;
	const text = { color: palette.muted, fontSize: 11, fontFamily: palette.font };
	const color = palette.series[0];
	const xs = extent(
		points.map((p) => p.x),
		{ include: x.signed ? [0] : [], pad: 0.1 }
	);
	const ys = extent(
		points.map((p) => p.y),
		{ include: y.signed ? [0] : [], pad: 0.1 }
	);
	const fit = fitLine(points.map((p) => [p.x, p.y] as const));
	const within = points.length
		? [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))]
		: [0, 0];
	const axis = (scale: Scale, ends: [number, number]) => ({
		type: 'value' as const,
		min: ends[0],
		max: ends[1],
		name: scale.unit ? `${scale.title} (${scale.unit})` : scale.title,
		nameLocation: 'middle' as const,
		nameTextStyle: {
			color: palette.text,
			fontSize: 12,
			fontWeight: 700 as const,
			fontFamily: palette.font
		},
		axisLine: { show: false },
		axisTick: { show: false },
		splitLine: { lineStyle: { color: palette.grid } },
		axisLabel: {
			...text,
			formatter: number(locale, scale.signed),
			showMinLabel: false,
			showMaxLabel: false
		}
	});
	const voices: Voice[] = ['habitual', 'attempt'];
	return {
		animationDuration: 250,
		textStyle: { fontFamily: palette.font },
		tooltip: tooltip(palette, input.tip),
		grid: { left: 64, right: 22, top: input.select ? 30 : 14, bottom: 52 },
		xAxis: { ...axis(x, xs), nameGap: 30 },
		yAxis: { ...axis(y, ys), nameGap: 46 },
		brush: input.select
			? {
					xAxisIndex: 0,
					yAxisIndex: 0,
					brushMode: 'single',
					transformable: false,
					throttleType: 'debounce',
					throttleDelay: 120,
					brushStyle: { color: palette.soft, borderColor: palette.primary, borderWidth: 1 },
					outOfBrush: { colorAlpha: 0.25 },
					toolbox: ['rect', 'clear']
				}
			: undefined,
		toolbox: input.select
			? {
					right: 14,
					top: 0,
					itemSize: 14,
					iconStyle: { borderColor: palette.muted },
					feature: { brush: { type: ['rect', 'clear'] } }
				}
			: undefined,
		series: [
			{
				id: 'ground',
				type: 'scatter',
				data: [],
				silent: true,
				tooltip: { show: false },
				markArea: {
					silent: true,
					data: [
						...zoneAreas(palette, x.zones ?? [], 'x', xs),
						...zoneAreas(palette, y.zones ?? [], 'y', ys)
					]
				},
				markLine: {
					silent: true,
					symbol: 'none',
					animation: false,
					label: { show: false },
					lineStyle: { color: palette.border, width: 1, type: 'solid' },
					data: [...(x.signed ? [{ xAxis: 0 }] : []), ...(y.signed ? [{ yAxis: 0 }] : [])]
				}
			},
			...(fit
				? [
						{
							id: 'fit',
							type: 'line' as const,
							silent: true,
							tooltip: { show: false },
							symbol: 'none',
							lineStyle: { color: palette.muted, width: 1.5, type: [5, 4] },
							data: within.map((at) => [at, fit.intercept + fit.slope * at])
						}
					]
				: []),
			...voices.map(
				(voice) =>
					({
						id: voice,
						name: voice,
						type: 'scatter',
						z: voice === 'attempt' ? 4 : 3,
						itemStyle: mark(palette, color, voice),
						emphasis: { scale: 1.5 },
						data: points
							.filter((p) => p.voice === voice)
							.map((p) => ({
								value: [p.x, p.y],
								take: p.id,
								symbolSize: p.id === input.mark ? 17 : 11
							}))
					}) as SeriesOption
			)
		] as SeriesOption[]
	};
}

/** How every measure goes with every other one, as a grid of r: blue with, orange against. */
export function matrixOption(input: {
	names: string[];
	cells: { x: number; y: number; r: number | null; n: number }[];
	palette: Palette;
	locale: string;
	picked?: [number, number] | null;
	tip?: Tip;
}): EChartsOption {
	const { palette, names, locale } = input;
	const text = { color: palette.muted, fontSize: 11, fontFamily: palette.font };
	const signed = number(locale, true);
	return {
		animationDuration: 200,
		textStyle: { fontFamily: palette.font },
		tooltip: tooltip(palette, input.tip),
		grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
		xAxis: {
			type: 'category',
			data: names,
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { ...text, interval: 0, rotate: names.length > 4 ? 30 : 0 },
			splitArea: { show: false }
		},
		yAxis: {
			type: 'category',
			data: names,
			inverse: true,
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { ...text, interval: 0 }
		},
		visualMap: {
			show: false,
			min: -1,
			max: 1,
			dimension: 2,
			// NOTE: two hues with a neutral middle: the series blue for "together", orange for "against"
			inRange: { color: [palette.series[1], palette.card, palette.series[0]] }
		},
		series: [
			{
				type: 'heatmap',
				data: input.cells
					.filter((cell) => cell.r !== null && cell.x !== cell.y)
					.map((cell) => ({
						value: [cell.x, cell.y, cell.r, cell.n],
						itemStyle:
							input.picked && input.picked[0] === cell.x && input.picked[1] === cell.y
								? { borderColor: palette.text, borderWidth: 2 }
								: { borderColor: palette.card, borderWidth: 2 }
					})),
				label: {
					show: true,
					color: palette.text,
					fontSize: 11,
					fontFamily: palette.font,
					formatter: (params) =>
						signed(Math.round(Number((params.value as number[])[2]) * 100) / 100)
				},
				emphasis: { itemStyle: { borderColor: palette.text, borderWidth: 2 } }
			}
		]
	};
}

/**
 * How the takes of each voice spread on one measure: a point per take in a row per voice,
 * the middle half as a bar, the median as a tick.
 */
export function spreadOption(input: {
	scale: Scale;
	rows: { name: string; voice: Voice; dots: Dot[] }[];
	palette: Palette;
	locale: string;
	mark?: string | null;
	tip?: Tip;
}): EChartsOption {
	const { palette, locale, scale } = input;
	const rows = input.rows.filter((row) => row.dots.length);
	const text = { color: palette.muted, fontSize: 11, fontFamily: palette.font };
	const color = palette.series[0];
	const reach = (scale.zones ?? [])
		.filter((zone) => zone.low !== null && zone.high !== null)
		.map((zone) => zone.low! + (zone.high! - zone.low!) / 4);
	const ends = extent(
		rows.flatMap((row) => row.dots.map((d) => d.value)),
		{ include: [...(scale.signed ? [0] : []), ...reach], pad: 0.1 }
	);
	/** A steady scatter across a row's height, so that equal values do not hide each other. */
	const jitter = (index: number) => (((index * 0.618_034) % 1) - 0.5) * 0.5;
	return {
		animationDuration: 200,
		textStyle: { fontFamily: palette.font },
		tooltip: tooltip(palette, input.tip),
		grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
		xAxis: {
			type: 'value',
			min: ends[0],
			max: ends[1],
			axisLine: { show: false },
			axisTick: { show: false },
			splitLine: { lineStyle: { color: palette.grid } },
			axisLabel: {
				...text,
				formatter: number(locale, scale.signed),
				showMinLabel: false,
				showMaxLabel: false
			}
		},
		yAxis: {
			type: 'value',
			min: -0.5,
			max: rows.length - 0.5,
			inverse: true,
			interval: 1,
			axisLine: { show: false },
			axisTick: { show: false },
			splitLine: { show: false },
			axisLabel: {
				...text,
				color: palette.text,
				customValues: rows.map((_, index) => index),
				formatter: (value: number) => rows[value]?.name ?? ''
			}
		},
		series: [
			{
				id: 'ground',
				type: 'scatter',
				data: [],
				silent: true,
				tooltip: { show: false },
				markArea: { silent: true, data: zoneAreas(palette, scale.zones ?? [], 'x', ends) },
				markLine: {
					silent: true,
					symbol: 'none',
					animation: false,
					label: { show: false },
					lineStyle: { color: palette.border, width: 1, type: 'solid' },
					data: scale.signed ? [{ xAxis: 0 }] : []
				}
			},
			{
				id: 'box',
				type: 'custom',
				silent: true,
				tooltip: { show: false },
				z: 2,
				data: rows.map((row, index) => {
					const values = row.dots.map((d) => d.value);
					return [
						index,
						quantile(values, 0.25),
						median(values),
						quantile(values, 0.75),
						values.length
					];
				}),
				renderItem: (_params, api) => {
					const row = Number(api.value(0));
					const [left] = api.coord([api.value(1), row]);
					const [middle, y] = api.coord([api.value(2), row]);
					const [right] = api.coord([api.value(3), row]);
					const size = api.size?.([0, 1]);
					const half = (Array.isArray(size) ? size[1] : 30) * 0.3;
					return {
						type: 'group',
						children: [
							...(Number(api.value(4)) >= 4
								? [
										{
											type: 'rect' as const,
											shape: {
												x: left,
												y: y - half,
												width: Math.max(right - left, 1),
												height: half * 2,
												r: 3
											},
											style: { fill: color, opacity: 0.14 }
										}
									]
								: []),
							{
								type: 'line' as const,
								shape: { x1: middle, y1: y - half - 2, x2: middle, y2: y + half + 2 },
								style: { stroke: color, lineWidth: 2.5, lineCap: 'round' as const }
							}
						]
					};
				}
			},
			...rows.map(
				(row, index) =>
					({
						id: row.voice,
						name: row.name,
						type: 'scatter',
						z: 4,
						itemStyle: mark(palette, color, row.voice),
						emphasis: { scale: 1.5 },
						data: row.dots.map((dot, at) => ({
							value: [dot.value, index + jitter(at)],
							take: dot.id,
							symbolSize: dot.id === input.mark ? 15 : 9
						}))
					}) as SeriesOption
			)
		] as SeriesOption[]
	};
}
