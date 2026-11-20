# puptrainer

A voice training companion: record yourself, have every take analysed, and
see how your voice changes over time. Built for self-guided voice
feminization practice, self-hosted, with recordings that never leave your
own machines.

Status: **milestone 2**. The lab works: every take is measured for pitch,
resonance, voice quality and range, each number comes with what it means
and how far to trust it, and the numbers are charted over time. Guided
practice is new: a catalogue of exercises with their sources, short
sessions that judge each rep against your own band, a comfort rating for
every rep, and a practice log. Voice exploration and lessons come next
([docs/architecture.md](docs/architecture.md)).

## Table of contents

1. [What it does](#1-what-it-does)
2. [Run it](#2-run-it)
3. [Run it as a service on NixOS](#3-run-it-as-a-service-on-nixos)
4. [Record your first takes](#4-record-your-first-takes)
5. [Practise](#5-practise)
6. [Import existing recordings](#6-import-existing-recordings)
7. [Where your data lives](#7-where-your-data-lives)
8. [Development](#8-development)
9. [Licence](#9-licence)

## 1. What it does

- **Records losslessly in the browser.** Echo cancellation, noise
  suppression and automatic gain are switched off; a level meter shows the
  target zone and warns about clipping, and a live spectrogram shows what
  the microphone hears.
- **Plays takes over a picture of them**: a spectrogram of the whole take
  with the level under it, a playhead, click to seek. One switch shows
  either the voice's harmonics or its resonances (formants).
- **Labels every take**: the microphone setup, what was spoken, the
  language, and whether it was your everyday voice or an attempt at the
  voice you are training.
- **Analyses takes in the background** with [Praat](https://www.praat.org)
  (through Parselmouth): the pitch and how it moves, an estimate of
  resonance (formants, apparent vocal-tract length), voice quality, the range
  of a glide. Every number comes with what it means and how far to trust it.
- **Reads every take against your own everyday voice**, on the two things
  the training is about: pitch (semitones above it) and resonance (how much
  higher the formants sit, in percent, on a strip with the scatter of your
  own everyday takes and the range where voices usually lie), and what
  that cost in loudness and clarity.
- **Shows resonance while you speak**: a live meter on the same strip,
  counted from your everyday takes or, for a held sound or a whisper, from
  the first sound of the take.
- **Shows progress** by target: the distance from your everyday voice over
  time, then each measurement behind it, per microphone setup and kind of
  take; and any two takes side by side.
- **Guides practice**: two short sessions, one for pitch and one for
  resonance, of drills that end in speech, after the teachers of the trans
  voice community, each rep judged on the one or two numbers it is about.
  Comfort comes first: it is asked before any number, and a strained rep
  never counts.
- **Never loses a recording.** A take is kept in the browser until the
  server has confirmed it, also across reloads and while the server is away.
- **English and Czech**, including reading passages written for both.

## 2. Run it

With [Nix](https://nixos.org) (flakes enabled):

```sh
# the API, serving the web app on http://127.0.0.1:8437
nix run github:tsandrini/puptrainer

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

| Variable                 | Default                     | What                                   |
| ------------------------ | --------------------------- | -------------------------------------- |
| `PUPTRAINER_DATA_DIR`    | `~/.local/share/puptrainer` | Database, its snapshots and recordings |
| `PUPTRAINER_BIND`        | `127.0.0.1:8437`            | Where the API listens                  |
| `PUPTRAINER_WEB_DIR`     | unset (set by Nix)          | The built web app to serve             |
| `PUPTRAINER_CONTENT_DIR` | `content` (set by Nix)      | Passages, protocols, metric texts      |
| `PUPTRAINER_API_URL`     | `http://127.0.0.1:8437`     | Where the worker reaches the API       |
| `PUPTRAINER_TOKEN_FILE`  | unset                       | A file with the access token           |

Without a token the API is open: keep it on `127.0.0.1`. To reach it from
other devices, set `PUPTRAINER_TOKEN_FILE` (or `PUPTRAINER_TOKEN`) for the
API and the worker; the web app then asks to sign in with that token.

## 3. Run it as a service on NixOS

The flake exports a module that runs the API and the worker as hardened
system services, with the data in `/var/lib/puptrainer`:

```nix
{
  inputs.puptrainer.url = "github:tsandrini/puptrainer";

  # in the machine's configuration:
  imports = [ inputs.puptrainer.nixosModules.default ];
  services.puptrainer.enable = true; # http://localhost:8437
}
```

To open it to your network, give it a token; the module refuses to listen
beyond the machine without one:

```nix
services.puptrainer = {
  enable = true;
  bind = "0.0.0.0:8437";
  tokenFile = config.age.secrets.puptrainer-token.path; # any root-readable file
  openFirewall = true;
};
```

The microphone only works on a secure page, so recording from another
device needs HTTPS in front (a reverse proxy); looking at takes and
listening does not. `services.puptrainer.api.enable` and
`services.puptrainer.worker.enable` split the two across machines, with
`worker.apiUrl` pointing the worker at the API.

## 4. Record your first takes

1. **Microphones**: add your setup (the microphone and where it sits).
   Takes are only comparable within one setup, so keep it the same.
2. **Record**: pick what to record. The baseline is six short takes:
   sustained vowels, a pitch glide, a reading passage and free speech in
   each language.
3. Watch the level: the loudest parts should land in the marked zone
   (−12 to −6 dBFS). The resonance meter and the spectrogram under it are
   guides, not measurements. Listen back, then save.
4. **Takes** lists everything; a take's page has the player, the take read
   against your everyday voice, its pitch over time, its numbers and its
   labels. Tick two takes to compare them.
5. **Progress** charts pitch and resonance over time, each against your
   everyday voice first, then measurement by measurement.

The texts of the exercises ("Anchor phrases") have buttons of their own
under the baseline: read one in your everyday voice, and every take of it
is read on resonance as well (three everyday takes also give its scatter).

Record a baseline in your everyday voice before you start training: it
cannot be recreated later.

## 5. Practise

1. **Practice → Your band**: set the pitch range you practise in, or take
   the common starting band (F3–A3). It is a tool you can move at any time,
   not a goal.
2. **Start a session**: "Pitch" (about 5 minutes) or "Resonance" (about
   6 minutes). Say how your voice feels; a hoarse voice is told to rest.
3. Each step explains what to do, why, when to stop, and links to the
   teacher's own material. Record a rep, stop, then rate how it felt. The
   result follows a few seconds later: met or not yet, with the numbers.
4. At the end, rate the session and note whether any tension lasted. The
   **practice log** keeps every session with its takes.

Every exercise can also be practised on its own from the catalogue. How
exercises are written and judged: [docs/exercises.md](docs/exercises.md).

## 6. Import existing recordings

**Import** takes WAV and FLAC files. Names in this form fill in the labels:

```text
2026-11-16_passage-en_habitual.wav
<date>_<item>[-<language>]_<habitual|attempt>.wav
```

Items are `vowels`, `glide`, `sustain`, `phrase`, `passage`, `free` and
`other`; the voice is `habitual`, `attempt` or `drill`.

## 7. Where your data lives

Everything is under one directory: `~/.local/share/puptrainer` by default
(`$XDG_DATA_HOME/puptrainer`), `/var/lib/puptrainer` with the NixOS module,
or wherever `PUPTRAINER_DATA_DIR` points. It is outside the repository on
purpose, so it does not depend on where the app is started from.

| In it                | What                                               |
| -------------------- | -------------------------------------------------- |
| `puptrainer.sqlite3` | Takes, labels, microphones, measurements, sessions |
| `audio/`             | The recordings as FLAC files, never rewritten      |
| `backups/`           | Snapshots of the database (the newest 14 are kept) |

The app snapshots its database once on each day it is started, and before
every change of the database's layout by a new version. Recordings are not
duplicated: nothing is sent anywhere else, and the repository contains no
recordings. **Back the directory up**; a recording cannot be recreated.

## 8. Development

```sh
direnv allow            # or: nix develop
(cd web && npm ci)
process-compose up      # API, worker and the web dev server
nix flake check         # every lint, test, the end-to-end run and the VM test
```

Then open <http://localhost:8436>. `process-compose up -D` keeps the three
running in the background (`process-compose attach` to look,
`process-compose down` to stop). This is also a fine way to simply use the
app on your own machine.

More in [docs/development.md](docs/development.md); how the pieces fit in
[docs/architecture.md](docs/architecture.md).

## 9. Licence

[EUPL-1.2](LICENSE). The reading passages and protocol texts under
`content/` were written for this project. The exercises paraphrase the
material of the teachers they name, in our own words, and link to it.
