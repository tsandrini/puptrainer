// One thing sounds at a time: the dock, a take's own player, a demo tone.
// Whoever starts to sound claims the floor and says how to be silenced;
// the previous holder is silenced first. A recorder silences everyone.

type Holder = { owner: symbol; stop: () => void };

let holder: Holder | null = null;

/** Start to sound: whoever sounded before is stopped. */
export function claimSound(owner: symbol, stop: () => void): void {
	if (holder && holder.owner !== owner) holder.stop();
	holder = { owner, stop };
}

/** Done sounding (paused, ended, gone). */
export function releaseSound(owner: symbol): void {
	if (holder?.owner === owner) holder = null;
}

/** Silence whatever sounds, e.g. before the microphone opens. */
export function hush(): void {
	holder?.stop();
	holder = null;
}
