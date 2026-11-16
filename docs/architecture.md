# Architecture

## Pieces

```text
Browser (web/, SvelteKit single-page app)
  record: AudioWorklet -> 24-bit WAV    live level and pitch (a guide only)
  upload queue in IndexedDB             takes, labels, numbers
        |  HTTP, /api/v1
        v
API (backend/src/puptrainer/api, FastAPI)
  SQLite: devices, takes, analysis jobs, metric values
  recordings as FLAC, addressed by content
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
  pipeline. The level and pitch shown while recording are computed in the
  browser as a guide and are never stored.
- **Every take carries its context**: the microphone setup, what was spoken,
  the language, the text that was read (with its version), and the intent
  (`habitual` or `attempt`). Numbers are only compared within a setup.
- **A take is never lost.** The browser writes a recording to IndexedDB
  before uploading and deletes it only when the API has confirmed it. The
  upload carries the queue item's id; the API answers a repeated id with the
  take it stored the first time.
- **Content is data.** Passages, protocols and the texts of the metrics live
  in `content/`, not in code. A passage's text is frozen once takes exist
  for it; a changed text is a new version.

## The pipeline (version 0.2.0)

Which numbers a take gets depends on what it contains (`puptrainer.core.metrics`):

| Group         | Metrics                                                                                                  | Measured on                  |
| ------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Recording     | duration, peak level, speech level, noise floor, clipped samples, voiced share                           | every take                   |
| Pitch         | median; 5th and 95th percentile, range and variability in semitones, time below, at and above 145–185 Hz | speech (median: also vowels) |
| Pitch         | share of subharmonic (creaky) frames                                                                     | speech, vowels               |
| Resonance     | median F1–F4 (speech only), formant spacing, apparent vocal-tract length                                 | speech, vowels               |
| Voice quality | CPPS, harmonics-to-noise ratio, spectral slope, on the voiced parts only                                 | speech, vowels               |
| Range         | lowest and highest note, range in semitones                                                              | glide                        |

A take also stores its pitch contour (a series, 10 ms steps) and, for a
vowels take, each sustained vowel with its pitch, formants, CPPS and HNR.

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

**Voice quality** is measured on the voiced stretches joined together, never
over pauses. CPPS uses the settings of the Acoustic Voice Quality Index.

Adding a metric: add it to `puptrainer.core.metrics.REGISTRY` with its group
and the kinds of take it applies to, give it a title, a description and a
note in `content/metrics/<language>.toml`, compute it in
`puptrainer.analysis.pipeline`, and raise `PIPELINE_VERSION`. The Takes page
then offers to analyse older takes again.

## Milestones

| Milestone | Scope                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Walking skeleton: record, import, store, analyse (quality, median pitch), list. **Done.**                                                                                                 |
| M1        | The lab: pitch distribution, resonance, voice quality, range, progress charts, comparison, re-analysis: **done**. Deployment (NixOS module, token login) and a validation write-up: open. |
| M2        | Exercise catalogue as data, guided sessions, comfort ratings                                                                                                                              |
| M3        | Voice map with saved presets, ear-training game                                                                                                                                           |
| M4        | Lesson path, stars, skill map                                                                                                                                                             |
