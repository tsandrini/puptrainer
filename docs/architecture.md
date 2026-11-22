# Architecture

## Pieces

```text
Browser (web/, SvelteKit single-page app)
  record: AudioWorklet -> 24-bit WAV    live level, pitch and spectrogram
  player: spectrogram of a whole take   (pictures, a guide only)
  practice: session runner, reference tones
  upload queue in IndexedDB             takes and practice sessions, in order
        |  HTTP, /api/v1
        v
API (backend/src/puptrainer/api, FastAPI)
  SQLite: devices, takes, analysis jobs, metric values,
          practice sessions, the pitch band's history
  recordings as FLAC, addressed by content
  judges practice takes when serving them (puptrainer.core.evaluation)
  serves the built web app and content/
        ^  HTTP: claim a job, fetch the audio, report the numbers
        |
Worker (backend/src/puptrainer/analysis)
  pipeline: Praat through Parselmouth
```

The worker talks to the API over HTTP only, so it can run on another machine
than the API and its storage.

## Principles

- **Recordings are the source of truth.** A take is stored losslessly as it
  was recorded: no resampling, no normalising. 16-bit input stays 16-bit,
  everything else becomes 24-bit FLAC.
- **Numbers are derived and versioned.** Every analysis job records the
  pipeline version that ran it. A take can be analysed again; its page shows
  the newest finished result.
- **One source of numbers.** What is stored comes from the worker's
  pipeline. The level, the pitch and the spectrograms shown while recording
  and playing are computed in the browser as a guide and are never stored.
- **Live guidance while a skill is new.** A learner without a teacher cannot
  tell whether a drill is going right, so pitch steps show the band, the
  note and the live pitch while recording, and resonance steps the live
  resonance meter with the formants spectrogram; other steps show the level
  only. Every step with a guide also draws the last 30 seconds as grids
  over time (`audio/live.ts`, `LiveTraces`), and a held sound a map of
  pitch against brightness. Always-on displays help the session and hurt
  what is kept, so fading them as skills settle belongs to the curriculum
  (M4).
- **A take is more than its numbers.** One number per take hides what
  happened in it. The pipeline keeps what it measures frame by frame, the
  API turns it into rows over time when asked (`core.trace`, never
  stored), and every player draws them under its picture on one time axis
  (`Traces`): three grids, one per unit (pitch in Hz; brightness and R1 in
  percent; lightness, loudness and clarity in dB against the take's first
  sound). Right after recording, before the analysis is in, the grids come
  from what the live graph drew, and say so.
- **The data in detail, like with like.** There is no teacher to say what
  changed, so every take is data to work with: a table to search, filter
  and sort, and a Progress page with its distance from the everyday voice
  over time, how each voice spreads, how the measures go together, every
  measurement and every exercise's judgement. Always for one microphone
  setup and one kind of take, over a chosen stretch of time; all kinds
  together show only the distances, which are each counted from the
  everyday takes of the take's own kind. A point is a take: the pointer
  names it and a click plays it.
- **Listening is part of reading the data.** A number says what changed,
  the recording says how it sounded, so a take is one click from any
  place it appears: the player is a dock in the app's shell that goes on
  while pages change, and walks through the list a take came from.
- **A number that cannot be read is not shown.** Linear prediction puts
  its lowest peak on the fundamental when that stands far above the
  harmonics over it, as in a light voice at a raised pitch: the "first
  resonance" then follows the pitch. The pipeline measures how often that
  happens and how far the fundamental leads; readings, judgements, traces
  and the live meter leave R1 out where either says so
  (`core.acoustics.r1_readable`) and say why. Whispered takes, which have
  no pitch, are where R1 is measured.
- **Two targets, read against the learner's own voice.** Pitch and
  resonance are what the training is about; every other number is a
  condition on them (clarity, loudness) or about the recording. The API
  reads each voice against the learner's earliest everyday takes of the
  most alike kind when it serves it (`core.reading`), like a judgement
  never stored. The live resonance meter measures those same everyday
  takes in the browser by its own method (`audio/formants.ts`, Burg at a
  fixed ceiling) and remembers the result on the device, so its zero is
  its own; it reads a brighter voice lower than the pipeline, which fits
  its analysis range to each take, and says so. A held sound or a whisper
  is counted from its own first moments instead, with a wider gate than
  speech: it is one sound, also when a quiet part follows a loud one or
  it comes in short puffs.
- **Every take carries its context**: the microphone setup, what was spoken,
  the language, the text that was read (with its version), and the intent
  (`habitual`, `attempt`, or `drill` for a sound made for an exercise).
  A practice take also carries its exercise, its session, the band it was
  recorded against and its comfort rating. Numbers are only compared within
  a setup.
- **The pipeline measures sounds; exercises judge them.** The worker knows
  the kind of take, never the exercise or the band. The API judges a
  practice take by its exercise's rule whenever it serves it, from the
  stored measurements and the take's own band; the judgement is never
  stored, so a changed rule needs no migration and a re-analysed take is
  judged anew. A rep rated strained never counts as met.
- **A take is never lost.** The browser writes a recording to IndexedDB
  before uploading and deletes it only when the API has confirmed it. The
  upload carries the queue item's id; the API answers a repeated id with the
  take it stored the first time. Practice sessions travel through the same
  queue, in the same order, so a session reaches the API before its takes;
  its id is made by the browser and writing it again changes nothing.
- **The database is snapshotted.** Labels and microphone setups cannot be
  recomputed, so the API copies the database into `backups/` once on each
  day it starts and before any migration changes its layout (SQLite's online
  backup; the newest 14 copies are kept). The data directory defaults to the
  user's data directory, outside any checkout.
- **Content is data.** Passages, protocols, the texts of the metrics, the
  skills, exercises and routines live in `content/`, not in code
  ([exercises.md](exercises.md)). A passage's text is frozen once takes
  exist for it; a changed text is a new version.

## Access

Without a token the API is open and meant for `127.0.0.1` only. With
`PUPTRAINER_TOKEN_FILE` set, everything under `/api/v1` except `health`,
`session`, `login` and `logout` needs the token:

- the **worker** sends it as `Authorization: Bearer …`;
- the **web app** signs in once (`POST /login`) and gets a session cookie
  (HttpOnly, SameSite=Strict, Secure behind HTTPS), because the audio player
  cannot send a header. The cookie holds a value derived from the token, not
  the token.

The NixOS module passes the token file as a systemd credential and refuses a
non-loopback `bind` without one.

Uploads are written to a file before they are decoded: libsndfile's
in-memory reader needs write+execute memory, which the hardened service is
denied (`MemoryDenyWriteExecute`).

## The pipeline (version 0.3.1)

Which numbers a take gets depends on what it contains
(`puptrainer.core.metrics`):

| Group         | Metrics                                                                                                  | Measured on                |
| ------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| Recording     | duration, peak level, speech level, noise floor, clipped samples, voiced share                           | every take                 |
| Pitch         | median; 5th and 95th percentile, range and variability in semitones, time below, at and above 145–185 Hz | speech (median: also held) |
| Pitch         | share of subharmonic (creaky) frames                                                                     | speech, held               |
| Resonance     | median F1–F4 (speech only), formant spacing, apparent vocal-tract length                                 | speech, held               |
| Resonance     | share of vowel frames whose F1 cannot be told from the pitch                                             | speech                     |
| Voice quality | CPPS, harmonics-to-noise ratio, spectral slope, on the voiced parts only                                 | speech, held               |
| Voice quality | lightness: how far the fundamental leads the second harmonic (H1–H2), on the vowels                      | speech, held               |
| Range         | lowest and highest note, range in semitones, breaks (jumps of 3 semitones or more)                       | glide                      |

Speech is a passage, free speech, a short phrase or another take; held is a
vowels take or a sustain take (held sounds for an exercise). A take also
stores series: its pitch contour (10 ms steps) and, in 20 ms steps, its
level, F1–F4, the lead of the fundamental and the cepstral peak prominence
of each frame. For a vowels or sustain take it stores each held sound of
1.5 s or more with its pitch, formants, CPPS, HNR, lightness and how much
of its R1 is unreadable, and for a whispered take each whispered second.

**Pitch.** Creaky voice and period doubling put energy at half the pitch,
and an autocorrelation tracker then reports the voice an octave low. The
track (Praat, 60–800 Hz, octave cost 0.1) is corrected frame by frame: a
frame that reads about half (0.45–0.56) of the median pitch within 0.75 s
around it is a subharmonic and is doubled. Where that neighbourhood is itself
far below the take's median, the take's median is the reference. The share
of frames a default tracker would read an octave low is a metric of its own.
A glide covers the whole range on purpose and is left as tracked.

**Resonance.** Burg's method finds five formants below a ceiling, so the
ceiling has to follow the voice: Praat's defaults of 5000 and 5500 Hz are
five times the formant spacing of an average man and woman. The pipeline
runs the analysis on a grid of ceilings (4500–6500 Hz) and interpolates the
one that equals five times the spacing it yields; runs with implausibly wide
formants are discarded. A fixed ceiling does not fail gracefully: with 5000
Hz a 14 cm vocal tract reads as 20 cm. The spacing is fitted to the median
F1–F4 of the voiced, louder frames as a uniform tube's (`F_i = spacing × (2i −

1. / 2`), and the tract length is the speed of sound over twice the spacing.
   It is an estimate of resonance for following a trend on one microphone
   setup, not an anatomical length.

Formants are not measured where the pitch is above 300 Hz: the harmonics
then lie too far apart to show the vocal tract, and the analysis would
report the harmonics themselves. The held sounds of a sustain take, which
differ in length on purpose, are each fitted with a ceiling of their own.
A held sound is one shape, so its upper formants stay within a few percent
from frame to frame; a ceiling at which they scatter by more than 15% (the
analysis splits a formant in two on some frames, or drops one) is left
out of the fit, and each held sound stores its scatter. On a real take a
ceiling picked by spacing alone read an "ah" as 579, 1126, 1347 and 2735
Hz and every sound after it as 20–40% "brighter".

**The first resonance and the pitch.** A frame's F1 cannot be told from
the pitch when it lies below 1.25 times the pitch, or below 1.75 times the
pitch while the fundamental leads the second harmonic by 12 dB or more.
The share of such frames is a metric. A take's (or a held sound's) R1 is
left out when that share reaches a quarter or the median lead reaches 12
dB: on one learner's takes everyday speech had 4–19% such frames and a
lead of 4–9 dB, attempts at a higher, lighter voice 33–49% and 10–14 dB,
and their median F1 read a fifth lower for that reason alone.

**Whispers.** A sustain take counts as whispered when at least a fifth of
its sounding frames are unvoiced. Its unvoiced frames within 15 dB of the
loudest (and 12 dB above the room) are read at a 5500 Hz ceiling, and each
second with eight or more of them is stored with its median formants. A
pitch above 300 Hz found in such a take is noise, not a voice, and the 0.2 s
either side of a voiced stretch of a quarter of a second or more are
neither voice nor whisper: there a soft voice reads its pitch as a
resonance.

**Voice quality** is measured on the voiced stretches joined together, never
over pauses. CPPS uses the settings of the Acoustic Voice Quality Index.
Lightness is uncorrected for the resonances: a first resonance close to
either harmonic shifts it, so it is compared on the same text or the same
held vowel only.

**Traces** (`GET /api/v1/takes/{id}/trace`) are the stored series as rows
at ten values a second: pitch, lightness, clarity and level for every
take; for a sustain take also brightness and R1 in percent against its
first held sound, or its first three whispered seconds. The first and last
step of a voiced stretch are left out of the source and resonance rows, a
whispered second is one value from end to end, and steps where R1 cannot
be read are marked. Speech has no resonance rows: formants follow the
words, so its brightness is one number for the take.

Adding a metric: add it to `puptrainer.core.metrics.REGISTRY` with its group
and the kinds of take it applies to, give it a title, a description and a
note in `content/metrics/<language>.toml`, compute it in
`puptrainer.analysis.pipeline`, and raise `PIPELINE_VERSION`. The Takes page
then offers to analyse older takes again.

## Milestones

| Milestone | Scope                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | Walking skeleton: record, import, store, analyse (quality, median pitch), list. **Done.**                                                                                      |
| M1        | The lab: pitch distribution, resonance, voice quality, range, progress charts, comparison, re-analysis, token login and a NixOS module: **done**. A validation write-up: open. |
| M2        | Exercise catalogue as data, guided sessions judged against the learner's band, comfort ratings, the practice log: **done**                                                     |
| M3        | Voice map with saved presets, ear-training game                                                                                                                                |
| M4        | Lesson path, stars, skill map                                                                                                                                                  |
