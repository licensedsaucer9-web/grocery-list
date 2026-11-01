# grocery-list

Phone-first grocery list PWA fed weekly from Notion. Weekly deals and staples
are entered in Notion; a small local sync job turns them into
`public/list.json`; GitHub Pages serves a static site that reads it.

Site: <https://licensedsaucer9-web.github.io/grocery-list/>
Spec: [`docs/plans/grocery-list.md`](docs/plans/grocery-list.md)

> **PUBLIC DATA WARNING.** This repo is public, so GitHub Pages is public too.
> `list.json` and the site can be read by anyone with the URL, and the file
> stays in git history forever. Only grocery names, prices, chains and deal
> notes go in it. The Notion token, page URLs/ids, `Source` URLs, and the
> Staples `Notes`/`Aliases` are never exported: the mapper (`sync/map.ts`)
> emits an explicit allowlist of fields, and a test checks it.

## Data flow

```
Notion (read-only) --> sync script (systemd user timer on joakimarchy)
                          writes public/list.json, commits + pushes if changed
                                  |
                       push to main --> Pages workflow --> static site
                                  |
                  phone PWA fetches ./list.json (cache bypass on refresh)
```

The Notion token only lives in `~/.config/grocery-list/env` on joakimarchy.
The web app never talks to Notion and contains no secrets.

- **App** (`index.html`, `src/`): Vite + TypeScript, no framework. Grouped
  sections, tap a row to check it off. Checked items are stored in
  `localStorage` under `grocery-list:checked:<list_hash>` and reset when the
  list changes. The refresh button bypasses all caches.
- **Offline**: `public/sw.js` precaches the app shell; `list.json` is
  network-first with fallback to the last cached copy. The last good list is
  also kept in `localStorage`.
- **Sync** (`scripts/sync.ts`, `sync/`): queries the Weekly hits, Staples and
  Chains databases, keeps the latest `Week start`, groups by staple group,
  and adds active staples without a deal to "Staples (no deal)". `list_hash`
  covers only the content, so an unchanged week produces no commit.

## Development

Needs Node 24+.

```sh
npm install
npm run dev          # http://localhost:5173/grocery-list/
npm test             # vitest: mapper, UI state, sync CLI
npm run build        # type-check, build dist/ and dist-sync/sync.mjs
npm run sync         # real sync (needs NOTION_TOKEN), writes public/list.json
npm run sync -- --dry-run   # fetch + map, print JSON, write nothing
npm run sync:sample  # no token/network: regenerate list.json from test fixtures
```

The service worker only registers in production builds; use
`npm run build && npm run preview` to test offline behaviour.

Icons are generated from `public/icons/icon.svg` with `npm run icons`
(needs `rsvg-convert`).

### Sync behaviour

| Situation | Result |
| --- | --- |
| `NOTION_TOKEN` unset/empty | prints `NOTION_TOKEN missing: …`, exit 2, list.json untouched |
| Notion error | message (token redacted), exit 1, list.json untouched |
| Mapped list is empty | exit 3, list.json untouched |
| Same `list_hash` as current file | file left alone, exit 0 |
| Changed | atomic write (temp file + rename), exit 0 |

### Environment

Put these in `~/.config/grocery-list/env` (mode 600):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NOTION_TOKEN` | required | Notion internal integration secret |
| `NOTION_HITS_DB` | `75cc9f4d981846be9c5d91f6a98f6b82` | Weekly hits database |
| `NOTION_STAPLES_DB` | `4fa7eec1a1ae4ecdbee62309922edea2` | Staples database |
| `NOTION_CHAINS_DB` | `2a12d05774d44d9caa51b65294ad4c39` | Chains database |
| `NOTION_HITS_DS`, `NOTION_STAPLES_DS`, `NOTION_CHAINS_DS` | resolved from the DB | Data source id overrides |

## Joakim's manual steps

1. **Notion integration**: Settings > Connections > Develop or manage
   integrations > new **internal** integration with only the *Read content*
   capability. Copy the secret.
2. **Share the databases** (Weekly hits, Staples, Chains) with the integration
   via each database's "..." > Connections. Sharing the parent page
   "Grocery deals" covers all three if they sit under it.
3. **Token file**:
   ```sh
   mkdir -p ~/.config/grocery-list
   install -m 600 /dev/null ~/.config/grocery-list/env
   echo 'NOTION_TOKEN=ntn_…' >> ~/.config/grocery-list/env
   ```
4. **Install the timer** (from a checkout of this repo):
   ```sh
   scripts/install.sh
   systemctl --user enable --now grocery-list-sync.timer
   systemctl --user start grocery-list-sync.service   # test once
   ```
   `install.sh` builds `dist-sync/sync.mjs`, copies it and `run-sync.sh` to
   `~/.local/grocery-list/`, clones the repo to `~/.local/grocery-list/repo`
   (separate from `~/src/grocery-list`), and installs the units into
   `~/.config/systemd/user/`. It is idempotent, never touches the env file,
   and does not enable anything. The clone pushes with your normal git
   credentials. Re-run it after upgrading Node or changing the sync code.
5. **Pages**: repo Settings > Pages > Source = **GitHub Actions**.
6. *(Fallback only)* add a `NOTION_TOKEN` repository secret, then run the
   "sync (manual fallback)" workflow from the Actions tab when the machine is
   off. It is manual-only so it never double-commits with the timer.
7. **iPhone**: open the site URL in Safari > Share > **Add to Home Screen**.
   iOS shows no install prompt, so this is the only way. The app then opens
   full screen and works offline with the last synced list.

### Timer

Runs daily at 08:30 Europe/Oslo with `Persistent=true`, so a missed run
happens after the machine wakes. Each run: `git pull --ff-only`, sync,
commit `chore: sync list (week <date>)` only if `list.json` changed, push.
A failed push or sync makes the unit fail.

Troubleshooting:

```sh
systemctl --user list-timers grocery-list-sync.timer
systemctl --user status grocery-list-sync.service
journalctl --user -u grocery-list-sync -n 50
```

- `NOTION_TOKEN missing`: the env file is missing or empty (step 3).
- `404`/`object_not_found` from Notion: the database is not shared with the
  integration (step 2).
- `git pull --ff-only` fails: someone changed `list.json` on `main` in a way
  that conflicts; reset the clone with
  `git -C ~/.local/grocery-list/repo fetch && git -C ~/.local/grocery-list/repo reset --hard origin/main`.

## CI

- `.github/workflows/ci.yml` (job `ci`): `npm ci`, `npm test`, `npm run build`
  on every push and pull request.
- `.github/workflows/pages.yml`: builds and deploys `dist/` to GitHub Pages on
  push to `main`. Sync commits trigger it, so the site updates within a
  minute or two.
- `.github/workflows/sync.yml`: manual fallback sync (see step 6).
