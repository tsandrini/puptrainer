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

## The README's screenshots

`web/scripts/screenshots.mjs` takes the pictures in `docs/assets/images`
from a demo dataset it makes itself: a week of takes of two made-up
people, whose voices it synthesises (vowels on a pitch line; no recording
of anybody is involved, and none may ever be). It needs what the
end-to-end run needs, and an API with an **empty** data directory; it
refuses one that already holds takes:

```sh
node web/scripts/screenshots.mjs --base http://127.0.0.1:8438 \
  --worker "python -m puptrainer.analysis.worker" --out docs/assets/images
```

Run it again when a page it shows has changed. The demo week has fixed
dates and seeds, so a page that did not change gives the same picture
(the Record page is photographed while it records, and differs a little
each time). A picture has to stay under 500 kB: the hook against large
files.

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

There are two chart engines, by what is drawn:

- **A signal over one take** (the take view, the live graph) is a `Plot`:
  a thin wrapper around [uPlot](https://github.com/leeoniya/uPlot)
  (canvas) with a text legend that says each line's value at the pointer
  or the playhead, shaded zones and stretches, a pointer shared between
  plots and a zoom shared by the plots bound to one `shown`.
- **Statistics over takes** (the Progress page) are
  [Apache ECharts](https://echarts.apache.org), behind a kit in
  `web/src/lib/components/charts/`: `echarts.ts` registers the parts in
  use, `Chart` draws an option and reports clicks and selections,
  `ChartCard` puts the same things around every chart (title, help, its
  own controls, whole screen, the numbers as a table, CSV, PNG),
  `StatTile` is a number with a small line. Nothing outside that
  directory imports ECharts. The options are built by pure functions in
  `web/src/lib/progress/options.ts` (tested without a browser), from the
  theme's colours as `palette.svelte.ts` reads them: ECharts knows
  neither `oklch()` nor CSS variables, so every token is painted once and
  read back as rgb.

The rules every chart keeps: one value axis per grid, so two units are
two grids; a hue says which measure a line is, never its position in a
list; **the voice is the line and the mark**: an attempt solid and
filled, the everyday voice dashed and hollow, a drill dotted
(`VoiceMark` is the same key in tables and legends); a reference range
is drawn and named wherever the measure has one; a point is a take (its
id travels with the datum, for the tooltip and the click); **a person is
the shape of the mark** (a circle for the default person, a triangle, a
square or a pin for the others: `lib/people.ts`, `PersonMark`), with
lines and rows of their own; text wears text colours. The six series
colours (`--series-1` to `--series-6`, light and dark) are a validated
set, for colour-blind separation and for contrast against both surfaces:
a seventh needs a new validated colour, not a guess.

## Interface conventions

- **Explanation sits behind `Help`** (`components/app/Help.svelte`): a
  "?" that opens on a click, beside a heading, a chart or a number. A
  page shows data and controls; what a thing means and how far to trust
  it is one click away. What a page says _about the take in front of it_
  (a reading's verdict, an exercise's advice, what a picture is counted
  from) is data and stays on the page.
- **A page's view is state that survives** (`lib/view.svelte.ts`):
  filters, search, sorting and the open tab live in the address and, per
  page, in sessionStorage, so a reload, the back button and a return
  through the navigation all find the page as it was. One `ViewState`
  per page, with a visible reset. Settings that are not part of a link
  (which columns a table shows) are `Kept` in localStorage.
- **One player** (`lib/player.svelte.ts`, `PlayerDock` in the layout):
  any play button outside a take's own page calls `player.toggle(take,
list)` with the takes around it. Nothing plays on hover. One thing
  sounds at a time (`lib/audio/focus.ts`): starting a player silences
  the other, and a recorder silences both.
- **Lists are a `DataTable`** (`components/data-table/`): TanStack
  `table-core` with shadcn-svelte's adapter, rows in memory. The page
  filters its rows (`FacetFilter`, `DateRange`) and declares columns;
  the table searches (`lib/highlight.ts`, cells mark matches with
  `Highlight`), sorts, pages and ticks.
- **One shell width.** The paw, the navigation and the banners are the
  same width on every page, so nothing of them moves from page to page.
  Inside, pages of tables and graphs take the room; pages to read and
  fill in keep a column in the middle (the layout names them).
- **Everything is reachable from the keyboard.** `CommandPalette` in the
  layout (`Ctrl K`) lists pages, sessions and exercises to start, takes
  and the shell's settings; a new page or action gets an entry there,
  and a new key gets a line in its keys dialog (`?`, the texts are
  `palette.sections`). Keys never fire while something is being typed.
- **A load that fails says so.** An empty state is for data that is
  really empty. When a list or a graph could not be loaded, the place it
  would be in says that, and the rest of the page stands.
- **People are kept apart.** A page of statistics shows the default
  person unless others are picked (`chosenPeople`; the view keeps
  nothing for the default person alone, so it follows whoever that is).
  A number about one person (a tile, a correlation, a fitted line) is
  never counted over two, and says whose it is once that could be
  mistaken. Lists say whose a take is once there is a second person;
  with one person nothing in the app mentions people but their page.
- **The UI kit** (`components/ui/`) is generated by shadcn-svelte's
  command (`npx shadcn-svelte add <component>`; the table adapter by its
  address, `https://shadcn-svelte.com/registry/data-table.json`) and
  then formatted. Its components style states as `data-open:`,
  `data-checked:` and the like, which `layout.css` defines as custom
  variants.

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
