# Development

## Layout

| Path           | What                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `backend/`     | The Python package `puptrainer`: `core` (settings, schemas, metric registry), `api`, `analysis` |
| `web/`         | The SvelteKit app (static single-page build)                                                    |
| `content/`     | Passages, protocols, metric texts, skills, exercises, routines (TOML)                           |
| `flake-parts/` | Nix: packages, checks, dev shell, pre-commit hooks                                              |

## The dev shell

`direnv allow` (or `nix develop`) gives Python with the backend's
dependencies from nixpkgs, ruff, pyright, Node, and process-compose. The
backend runs from the source tree (`PYTHONPATH=backend/src`).

```sh
(cd web && npm ci)
process-compose up        # or: process-compose up -D, then attach / down
```

That starts the API on `127.0.0.1:8437`, the worker, and Vite on
<http://localhost:8436> (which proxies `/api` to the API). The data is the
same as in normal use: `~/.local/share/puptrainer`, snapshotted on start and
before a migration.

Other ports or a scratch data directory go in the shell's environment or in
a `.env` file at the repository root (process-compose reads it, git ignores
it):

```sh
PUPTRAINER_BIND=127.0.0.1:9437
PUPTRAINER_API_URL=http://127.0.0.1:9437
PUPTRAINER_WEB_PORT=9436
PUPTRAINER_DATA_DIR=data   # a throwaway database in the checkout
```

The dev server fails on a taken port instead of moving to the next one.

## Checks

```sh
nix flake check                 # everything below, on the built packages
(cd backend && pytest)          # backend tests
(cd backend && ruff check . && ruff format --check . && pyright)
(cd web && npm run check && npm run lint && npm test)
```

Backend tests run on synthetic audio (tones with and without subharmonics,
silence, noise, clipping). No voice recording is in the repository or needed
by any check.

## The end-to-end run

`web/scripts/e2e.mjs` drives the built app in a headless Chromium whose
microphone is a synthetic tone: the lab, and guided practice sessions with
their failure paths (worker stopped, API away mid-session, a strained rep,
a hoarse check-in). `nix flake check` runs it against the built packages.
By hand, against an API with an **empty** data directory:

```sh
export PLAYWRIGHT_CORE=$(nix build nixpkgs#playwright-driver --no-link --print-out-paths)
export PLAYWRIGHT_BROWSERS_PATH=$(nix build nixpkgs#playwright-driver.browsers --no-link --print-out-paths)
(cd web && npm run build)
PUPTRAINER_DATA_DIR=$(mktemp -d) PUPTRAINER_WEB_DIR=web/build PUPTRAINER_BIND=127.0.0.1:8438 \
  python -m puptrainer.api &
node web/scripts/e2e.mjs --base http://127.0.0.1:8438 --worker "python -m puptrainer.analysis.worker"
```

## The NixOS module

`flake-parts/modules/nixos/puptrainer.nix`; `checks.vm` boots a machine with
it (API behind a token, worker beside it), uploads a synthetic take and
waits for its analysis:

```sh
nix build .#checks.x86_64-linux.vm -L
```

## Generated files

- **`web/src/lib/api/types.ts`** comes from the models in
  `backend/src/puptrainer/core/schemas.py`. After changing a model:

  ```sh
  (cd backend && python -m puptrainer.api.tstypes > ../web/src/lib/api/types.ts)
  ```

  A backend test fails when the file is stale.

- **`npmDepsHash`** in `flake-parts/pkgs/puptrainer-web.nix` follows
  `web/package-lock.json`:

  ```sh
  prefetch-npm-deps web/package-lock.json
  ```

## Database migrations

The API migrates its database at start-up (Alembic, scripts inside the
package). To add a migration after changing `puptrainer/api/db.py`:

```sh
cd backend && alembic revision --autogenerate -m "what changed"
```

A test compares the migrated schema with the models.

## Look and charts

The theme (colours for light and dark, the font, the paw motif) is in
`web/src/routes/layout.css`; components use its tokens, never raw colours.
Charts are built with layerchart in `web/src/lib/components/charts/`. The two
series colours (`--series-1` for the everyday voice, `--series-2` for
attempts) are a validated pair: a colour follows the voice it stands for,
and a third series needs a new validated colour, not a guess.

Spectrograms (`web/src/lib/audio/spectrum.ts`, drawn by the components in
`web/src/lib/components/audio/`) are computed in the browser with the
module's own FFT: 0–5 kHz, a long window for harmonics or a short one for
formants, shaded over 65 dB below the loudest point of the picture. Their
ramp is one hue from the card's surface outwards, per theme, hard-coded in
that module from the theme's rose; change both when the theme changes.

## Translations

`web/src/lib/i18n/en.ts` is the source of the message keys; `cs.ts` is typed
against it, so a missing key fails `npm run check`. Content texts (passage
titles, instructions, metric descriptions) are in `content/`, one entry per
language.
