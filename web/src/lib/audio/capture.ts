// Records the microphone losslessly: the browser's processing (echo
// cancellation, noise suppression, automatic gain) is switched off, the
// samples come through an AudioWorklet at the device's own rate and end up
// in a 24-bit WAV file. While recording, every block reports its level and
// a live pitch estimate.

import { hush } from './focus.js';
import { levelOf, type Level } from './meter.js';
import { detectPitch } from './pitch.js';
import { encodeWav } from './wav.js';

/** What one captured block tells the screen; `samples` are the block itself, for live pictures. */
export type Frame = Level & {
	pitchHz: number | null;
	seconds: number;
	samples: Float32Array;
	sampleRate: number;
};

/** A finished recording. */
export type Recording = {
	wav: ArrayBuffer;
	sampleRate: number;
	seconds: number;
	peakDb: number;
	clipped: number;
};

/** Why recording could not start. */
export type CaptureProblem = 'denied' | 'no-microphone' | 'insecure' | 'failed';

export class CaptureError extends Error {
	constructor(
		public problem: CaptureProblem,
		message: string
	) {
		super(message);
	}
}

/** The audio inputs the browser knows; labels are empty until permission is given. */
export async function listInputs(): Promise<MediaDeviceInfo[]> {
	if (!navigator.mediaDevices?.enumerateDevices) return [];
	return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
}

export class Recorder {
	#stream: MediaStream | null = null;
	#context: AudioContext | null = null;
	#node: AudioWorkletNode | null = null;
	#blocks: Float32Array[] = [];
	#samples = 0;
	#peakDb = -120;
	#clipped = 0;
	#done: (() => void) | null = null;

	constructor(private onFrame: (frame: Frame) => void) {}

	get active(): boolean {
		return this.#context !== null;
	}

	/**
	 * Opens the microphone and starts collecting samples.
	 *
	 * @param inputId the browser's id of the input to use; the system default when omitted
	 * @throws CaptureError when the page is not secure, permission is refused, no microphone
	 *   exists, or the audio graph cannot be built
	 */
	async start(inputId?: string): Promise<void> {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new CaptureError('insecure', 'getUserMedia is not available');
		}
		// NOTE: echo cancellation is off: anything still playing would be recorded
		hush();
		try {
			this.#stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					deviceId: inputId ? { exact: inputId } : undefined,
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					channelCount: 1
				}
			});
		} catch (e) {
			const name = e instanceof DOMException ? e.name : '';
			const problem: CaptureProblem =
				name === 'NotAllowedError' || name === 'SecurityError'
					? 'denied'
					: name === 'NotFoundError' || name === 'OverconstrainedError'
						? 'no-microphone'
						: 'failed';
			throw new CaptureError(problem, e instanceof Error ? e.message : String(e));
		}
		try {
			// NOTE: the device's own rate, so the browser does not resample
			const rate = this.#stream.getAudioTracks()[0]?.getSettings().sampleRate;
			this.#context = new AudioContext(rate ? { sampleRate: rate } : undefined);
			await this.#context.audioWorklet.addModule('/capture-worklet.js');
			const source = this.#context.createMediaStreamSource(this.#stream);
			this.#node = new AudioWorkletNode(this.#context, 'capture', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				channelCount: 1,
				channelCountMode: 'explicit'
			});
			this.#node.port.onmessage = (event) => this.#receive(event.data);
			// NOTE: a silent path to the output keeps the graph running in every browser
			const mute = this.#context.createGain();
			mute.gain.value = 0;
			source.connect(this.#node).connect(mute).connect(this.#context.destination);
		} catch (e) {
			this.cancel();
			throw new CaptureError('failed', e instanceof Error ? e.message : String(e));
		}
	}

	#receive(data: Float32Array | 'done') {
		if (data === 'done') {
			this.#done?.();
			return;
		}
		const sampleRate = this.#context?.sampleRate ?? 48000;
		this.#blocks.push(data);
		this.#samples += data.length;
		const level = levelOf(data);
		this.#peakDb = Math.max(this.#peakDb, level.peakDb);
		this.#clipped += level.clipped;
		this.onFrame({
			...level,
			pitchHz: detectPitch(data, sampleRate)?.hz ?? null,
			seconds: this.#samples / sampleRate,
			samples: data,
			sampleRate
		});
	}

	/** Stops and returns the recording; the microphone is released. */
	async stop(): Promise<Recording> {
		const context = this.#context;
		const node = this.#node;
		if (!context || !node) throw new CaptureError('failed', 'not recording');
		await new Promise<void>((resolve) => {
			this.#done = resolve;
			node.port.postMessage('flush');
			// NOTE: a closed or stalled graph never answers; do not hang on it
			setTimeout(resolve, 500);
		});
		const recording: Recording = {
			wav: encodeWav(this.#blocks, context.sampleRate),
			sampleRate: context.sampleRate,
			seconds: this.#samples / context.sampleRate,
			peakDb: this.#peakDb,
			clipped: this.#clipped
		};
		this.cancel();
		return recording;
	}

	/** Stops without a result and releases the microphone. */
	cancel(): void {
		this.#stream?.getTracks().forEach((track) => track.stop());
		this.#node?.disconnect();
		void this.#context?.close();
		this.#stream = null;
		this.#context = null;
		this.#node = null;
		this.#blocks = [];
		this.#samples = 0;
		this.#peakDb = -120;
		this.#clipped = 0;
		this.#done = null;
	}
}
