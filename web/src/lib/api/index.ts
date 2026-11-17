// The API's endpoints, one typed function each. The types are generated
// from the backend's models (`python -m puptrainer.api.tstypes`).

import { api, getJson, patchJson, postJson, putJson, query } from './client.js';
import type {
	Content,
	DeviceIn,
	DeviceOut,
	Health,
	MetricDef,
	Requeued,
	Series,
	SessionOut,
	TakeMeta,
	TakeOut,
	TakePatch
} from './types.js';

export type * from './types.js';

export const fetchSession = () => getJson<SessionOut>('session');
/** Signs in with the access token; the API answers with a session cookie. */
export const login = (token: string) =>
	api('login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token })
	});
export const logout = () => api('logout', { method: 'POST' });

export const fetchHealth = () => getJson<Health>('health');
export const fetchContent = () => getJson<Content>('content');
export const fetchMetrics = () => getJson<MetricDef[]>('metrics');

export const fetchDevices = () => getJson<DeviceOut[]>('devices');
export const createDevice = (body: DeviceIn) => postJson<DeviceOut>('devices', body);
export const updateDevice = (id: number, body: DeviceIn) =>
	putJson<DeviceOut>(`devices/${id}`, body);

export type TakeFilter = { item?: string; intent?: string; language?: string; device_id?: number };

export const fetchTakes = (filter: TakeFilter = {}) => getJson<TakeOut[]>(`takes${query(filter)}`);
export const fetchTake = (id: string) => getJson<TakeOut>(`takes/${encodeURIComponent(id)}`);
export const updateTake = (id: string, body: TakePatch) =>
	patchJson<TakeOut>(`takes/${encodeURIComponent(id)}`, body);
export const deleteTake = (id: string) =>
	api(`takes/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const analyseTake = (id: string) =>
	postJson<TakeOut>(`takes/${encodeURIComponent(id)}/analysis`, {});
export const takeAudioUrl = (id: string) => `/api/v1/takes/${encodeURIComponent(id)}/audio`;
export const fetchSeries = (id: string, key: string) =>
	getJson<Series>(`takes/${encodeURIComponent(id)}/series/${encodeURIComponent(key)}`);

/** Queues takes for analysis again: those not analysed by `pipelineVersion`, or all of them. */
export const requeueAnalysis = (pipelineVersion?: string | null) =>
	postJson<Requeued>(`analysis/requeue${query({ pipeline_version: pipelineVersion })}`, {});

/** Uploads a recording (WAV or FLAC) with its labels. */
export async function createTake(file: Blob, meta: TakeMeta, name: string): Promise<TakeOut> {
	const form = new FormData();
	form.append('file', file, name);
	form.append('meta', JSON.stringify(meta));
	return (await api('takes', { method: 'POST', body: form })).json();
}
