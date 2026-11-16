// A mono 24-bit PCM WAV file from the captured float samples. 24 bits is
// what the API stores (FLAC), so nothing is lost or rounded twice.

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 3;
const FULL_SCALE = 0x7fffff;

/** Encodes blocks of samples in [-1, 1] as a WAV file's bytes. */
export function encodeWav(blocks: Float32Array[], sampleRate: number): ArrayBuffer {
	const frames = blocks.reduce((n, b) => n + b.length, 0);
	const dataBytes = frames * BYTES_PER_SAMPLE;
	const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // channels
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
	view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
	view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);
	let offset = HEADER_BYTES;
	for (const block of blocks) {
		for (let i = 0; i < block.length; i++) {
			const clamped = Math.max(-1, Math.min(1, block[i]));
			// NOTE: rounds half away from zero, so positive and negative samples mirror each other
			const value = Math.sign(clamped) * Math.round(Math.abs(clamped) * FULL_SCALE);
			view.setUint8(offset, value & 0xff);
			view.setUint8(offset + 1, (value >> 8) & 0xff);
			view.setUint8(offset + 2, (value >> 16) & 0xff);
			offset += BYTES_PER_SAMPLE;
		}
	}
	return buffer;
}
