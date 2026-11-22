// The theme's colours as a canvas reads them. ECharts interpolates and
// lightens colours itself and knows neither `oklch()` nor CSS variables, so
// every token is painted once and read back as rgb. It follows the theme.
import { browser } from '$app/env';
import { theme } from '#lib/theme.svelte.js';
import type { Palette } from './options.js';

const FALLBACK: Palette = {
	text: '#222',
	muted: '#777',
	grid: '#eee',
	border: '#ddd',
	card: '#fff',
	popover: '#fff',
	series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
	good: '#0a8f3c',
	warning: '#b87a00',
	primary: '#c0277a',
	soft: 'rgba(192,39,122,0.14)',
	font: 'sans-serif'
};

let pixel: CanvasRenderingContext2D | null = null;

/** Any CSS colour as `rgb()` or `rgba()`. */
function resolve(color: string, alpha = 1): string {
	pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!pixel || !color) return color;
	pixel.clearRect(0, 0, 1, 1);
	pixel.fillStyle = '#000';
	pixel.fillStyle = color;
	pixel.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
	const opacity = Math.round((a / 255) * alpha * 1000) / 1000;
	// NOTE: the pixel is premultiplied back by the browser; a translucent token loses a shade at most
	return opacity >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${opacity})`;
}

function read(): Palette {
	if (!browser) return FALLBACK;
	const style = getComputedStyle(document.documentElement);
	const token = (name: string, alpha = 1) => resolve(style.getPropertyValue(name).trim(), alpha);
	return {
		text: token('--foreground'),
		muted: token('--muted-foreground'),
		grid: token('--chart-grid'),
		border: token('--border'),
		card: token('--card'),
		popover: token('--popover'),
		series: [1, 2, 3, 4, 5, 6].map((index) => token(`--series-${index}`)),
		good: token('--good'),
		warning: token('--warning'),
		primary: token('--primary'),
		soft: token('--primary', 0.14),
		font: getComputedStyle(document.body).fontFamily
	};
}

class Colours {
	/** The palette of the theme that is on. */
	readonly value: Palette = $derived.by(() => {
		// NOTE: the class on <html> flips before effects run (see theme.svelte.ts)
		void theme.dark;
		return read();
	});
}

export const colours = new Colours();
