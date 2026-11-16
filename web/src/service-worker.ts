// The app's service worker: keeps the app shell available offline (the
// build's files cache-first, the page network-first with the cache as the
// fallback). The API is never touched: recordings wait in IndexedDB, not here.

/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `puptrainer-${version}`;
const SHELL = '/';
/** The build's chunks and the static files, as absolute paths. */
const ASSETS = new Set(
	[...immutable, ...assets]
		.map((entry) => (typeof entry === 'string' ? entry : (entry as { path: string }).path))
		.map((p) => (p.startsWith('/') ? p : `/${p}`))
);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([SHELL, ...ASSETS]))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

/** Same origin, GET, not the API. */
function ours(request: Request): URL | null {
	if (request.method !== 'GET') return null;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return null;
	if (url.pathname.startsWith('/api/')) return null;
	return url;
}

self.addEventListener('fetch', (event) => {
	const url = ours(event.request);
	if (!url) return;
	if (event.request.mode === 'navigate') {
		event.respondWith(networkFirst(event.request, SHELL));
	} else if (ASSETS.has(url.pathname)) {
		event.respondWith(cacheFirst(event.request));
	}
});

async function networkFirst(request: Request, key: string): Promise<Response> {
	const cache = await caches.open(CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(key, response.clone());
		return response;
	} catch {
		return (await cache.match(key)) || Response.error();
	}
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}
