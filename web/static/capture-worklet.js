// The recording's AudioWorklet: forwards the microphone's samples to the
// page in blocks of 2048, untouched. A `flush` message sends what is left
// and then `done`.

const BLOCK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.block = new Float32Array(BLOCK);
		this.filled = 0;
		this.port.onmessage = (event) => {
			if (event.data !== 'flush') return;
			if (this.filled) this.port.postMessage(this.block.slice(0, this.filled));
			this.filled = 0;
			this.port.postMessage('done');
		};
	}

	process(inputs) {
		const channel = inputs[0]?.[0];
		if (!channel) return true;
		let read = 0;
		while (read < channel.length) {
			const count = Math.min(channel.length - read, BLOCK - this.filled);
			this.block.set(channel.subarray(read, read + count), this.filled);
			this.filled += count;
			read += count;
			if (this.filled === BLOCK) {
				this.port.postMessage(this.block.slice(0));
				this.filled = 0;
			}
		}
		return true;
	}
}

registerProcessor('capture', CaptureProcessor);
