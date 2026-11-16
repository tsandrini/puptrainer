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

## The pipeline (version 0.1.0)

| Metric              | How                                                       |
| ------------------- | --------------------------------------------------------- |
| `duration_s`        | Length of the recording                                   |
| `peak_dbfs`         | Largest sample magnitude                                  |
| `clipped_samples`   | Samples at full scale                                     |
| `speech_level_dbfs` | 90th percentile of the RMS of 20 ms frames                |
| `noise_floor_dbfs`  | 5th percentile of the same                                |
| `voiced_fraction`   | Share of 10 ms frames Praat's pitch tracker calls voiced  |
| `pitch_median_hz`   | Median of the voiced frames' pitch, tracked in two passes |

Pitch is tracked twice. Creaky voice and period doubling put energy at half
the pitch, and Praat's defaults then report the voice an octave low. The
first pass (60–800 Hz, octave cost 0.1) finds the median; the second raises
the floor to 0.7 times that median. A glide covers the whole range on
purpose and is tracked once.

Adding a metric: add it to `puptrainer.core.metrics.REGISTRY`, give it a
title and description in `content/metrics/<language>.toml`, compute it in
`puptrainer.analysis.pipeline`, and raise `PIPELINE_VERSION`.

## Milestones

| Milestone | Scope                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Walking skeleton: record, import, store, analyse (quality, median pitch), list. **Done.**                                                                                 |
| M1        | The lab: pitch distribution, formants and resonance estimate, voice quality, history charts, A/B player, re-analysis of all takes, deployment (NixOS module, token login) |
| M2        | Exercise catalogue as data, guided sessions, comfort ratings                                                                                                              |
| M3        | Voice map with saved presets, ear-training game                                                                                                                           |
| M4        | Lesson path, stars, skill map                                                                                                                                             |
