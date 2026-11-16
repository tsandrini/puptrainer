# Development

## Layout

| Path           | What                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `backend/`     | The Python package `puptrainer`: `core` (settings, schemas, metric registry), `api`, `analysis` |
| `web/`         | The SvelteKit app (static single-page build)                                                    |
| `content/`     | Passages, protocols, metric texts (TOML)                                                        |
| `flake-parts/` | Nix: packages, checks, dev shell, pre-commit hooks                                              |

## The dev shell

`direnv allow` (or `nix develop`) gives Python with the backend's
dependencies from nixpkgs, ruff, pyright, Node, and process-compose. The
backend runs from the source tree (`PYTHONPATH=backend/src`).

```sh
(cd web && npm ci)
process-compose up
```

That starts the API on `127.0.0.1:8437`, the worker, and Vite on
<http://localhost:5173> (which proxies `/api` to the API). Data goes to
`./data`.

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
microphone is a synthetic tone. `nix flake check` runs it against the built
packages. By hand, against an API with an **empty** data directory:

```sh
export PLAYWRIGHT_CORE=$(nix build nixpkgs#playwright-driver --no-link --print-out-paths)
export PLAYWRIGHT_BROWSERS_PATH=$(nix build nixpkgs#playwright-driver.browsers --no-link --print-out-paths)
(cd web && npm run build)
PUPTRAINER_DATA_DIR=$(mktemp -d) PUPTRAINER_WEB_DIR=web/build PUPTRAINER_BIND=127.0.0.1:8438 \
  python -m puptrainer.api &
node web/scripts/e2e.mjs --base http://127.0.0.1:8438 --worker "python -m puptrainer.analysis.worker"
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

## Translations

`web/src/lib/i18n/en.ts` is the source of the message keys; `cs.ts` is typed
against it, so a missing key fails `npm run check`. Content texts (passage
titles, instructions, metric descriptions) are in `content/`, one entry per
language.
