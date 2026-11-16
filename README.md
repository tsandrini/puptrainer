# puptrainer

A voice training companion: record yourself, have every take analysed, and
see how your voice changes over time. Built for self-guided voice
feminization practice, self-hosted, with recordings that never leave your
own machines.

Status: **milestone 1 in progress**. Recording, import, lossless storage and
the lab work: every take is measured for pitch, resonance, voice quality and
range, each number comes with what it means and how far to trust it, and
the numbers are charted over time. Login and deployment, exercises and
lessons are next ([docs/architecture.md](docs/architecture.md)).

## Table of contents

1. [What it does](#1-what-it-does)
2. [Run it](#2-run-it)
3. [Record your first takes](#3-record-your-first-takes)
4. [Import existing recordings](#4-import-existing-recordings)
5. [Where your data lives](#5-where-your-data-lives)
6. [Development](#6-development)
7. [Licence](#7-licence)

## 1. What it does

- **Records losslessly in the browser.** Echo cancellation, noise
  suppression and automatic gain are switched off; a level meter shows the
  target zone and warns about clipping.
- **Labels every take**: the microphone setup, what was spoken, the
  language, and whether it was your everyday voice or an attempt at the
  voice you are training.
- **Analyses takes in the background** with [Praat](https://www.praat.org)
  (through Parselmouth): the pitch and how it moves, an estimate of
  resonance (formants, apparent vocal-tract length), voice quality, the range
  of a glide. Every number comes with what it means and how far to trust it.
- **Shows progress**: each measurement over time, per microphone setup and
  kind of take, and any two takes side by side.
- **Never loses a recording.** A take is kept in the browser until the
  server has confirmed it, also across reloads and while the server is away.
- **English and Czech**, including reading passages written for both.

## 2. Run it

With [Nix](https://nixos.org) (flakes enabled):

```sh
# the API, serving the web app on http://127.0.0.1:8437
PUPTRAINER_DATA_DIR=~/puptrainer-data nix run github:tsandrini/puptrainer

# in a second terminal: the analysis worker
nix shell github:tsandrini/puptrainer -c puptrainer-worker
```

Open <http://127.0.0.1:8437>. The microphone needs a secure page, which
`localhost` is; from another device you need HTTPS in front of it.

Without Nix: Python 3.12 or newer and Node 22 or newer.

```sh
cd web && npm ci && npm run build && cd ..
pip install './backend[api,analysis]'
PUPTRAINER_WEB_DIR=web/build puptrainer-api   # from the repository root
puptrainer-worker                             # second terminal
```

Settings are environment variables:

| Variable                 | Default                 | What                              |
| ------------------------ | ----------------------- | --------------------------------- |
| `PUPTRAINER_DATA_DIR`    | `data`                  | Database and recordings           |
| `PUPTRAINER_BIND`        | `127.0.0.1:8437`        | Where the API listens             |
| `PUPTRAINER_WEB_DIR`     | unset (set by Nix)      | The built web app to serve        |
| `PUPTRAINER_CONTENT_DIR` | `content` (set by Nix)  | Passages, protocols, metric texts |
| `PUPTRAINER_API_URL`     | `http://127.0.0.1:8437` | Where the worker reaches the API  |

There is no login yet: keep the API on `127.0.0.1`.

## 3. Record your first takes

1. **Microphones**: add your setup (the microphone and where it sits).
   Takes are only comparable within one setup, so keep it the same.
2. **Record**: pick what to record. The baseline is six short takes:
   sustained vowels, a pitch glide, a reading passage and free speech in
   each language.
3. Watch the level: the loudest parts should land in the marked zone
   (−12 to −6 dBFS). Listen back, then save.
4. **Takes** lists everything; a take's page has the player, its pitch over
   time, its numbers and its labels. Tick two takes to compare them.
5. **Progress** charts each measurement over time.

Record a baseline in your everyday voice before you start training: it
cannot be recreated later.

## 4. Import existing recordings

**Import** takes WAV and FLAC files. Names in this form fill in the labels:

```text
2026-11-16_passage-en_habitual.wav
<date>_<item>[-<language>]_<habitual|attempt>.wav
```

Items are `vowels`, `glide`, `passage`, `free` and `other`.

## 5. Where your data lives

Everything is under `PUPTRAINER_DATA_DIR`: a SQLite database and the
recordings as FLAC files. Nothing is sent anywhere else, and the repository
contains no recordings. Back that directory up.

## 6. Development

```sh
direnv allow            # or: nix develop
(cd web && npm ci)
process-compose up      # API, worker, web dev server on http://localhost:5173
nix flake check         # every lint, test and the end-to-end run
```

More in [docs/development.md](docs/development.md); how the pieces fit in
[docs/architecture.md](docs/architecture.md).

## 7. Licence

[EUPL-1.2](LICENSE). The reading passages and protocol texts under
`content/` were written for this project.
