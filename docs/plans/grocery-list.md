# grocery-list implementation plan

Phone-first shopping list PWA. Weekly deals and staples are entered in Notion;
a local sync job turns them into `public/list.json`; GitHub Pages serves a
static site that reads it.

> **PUBLIC DATA WARNING.** The repo is public on the GitHub free plan, so
> GitHub Pages is public. `list.json` and the site are readable by anyone with
> the URL, and the file is also in git history forever. Only put grocery
> names, prices, chains and notes in it. Never put the Notion token, page
> URLs/ids, `Source` URLs, or private notes in it. The mapper emits an explicit
> allowlist of fields. The `Notes` and `Aliases` properties of Staples are
> never exported.

## 1. Architecture

```
Notion (read-only) --> sync script (systemd user timer, joakimarchy)
                          writes public/list.json, commits + pushes if changed
                                  |
                       push to main --> Pages workflow --> static site
                                  |
                  phone PWA fetches ./list.json (cache bypass on refresh)
```

The token only exists in `~/.config/grocery-list/env` on joakimarchy. The
client never talks to Notion.

## 2. Notion source (read-only)

Parent page "Grocery deals" `3c7cea21-0a41-816e-a9b8-ca9887be1fe2`.

| Env var | Default (from this plan) | Role |
| --- | --- | --- |
| `NOTION_TOKEN` | none, required | internal integration secret |
| `NOTION_HITS_DB` | `75cc9f4d981846be9c5d91f6a98f6b82` | weekly hits |
| `NOTION_STAPLES_DB` | `4fa7eec1a1ae4ecdbee62309922edea2` | staples |
| `NOTION_CHAINS_DB` | `2a12d05774d44d9caa51b65294ad4c39` | store names |

The data source ids (hits `205832ad-…`, staples `a93b3ab2-…`) are resolved at
runtime from the DB ids (`GET /v1/databases/{id}` lists `data_sources`).
Override with `NOTION_HITS_DS` / `NOTION_STAPLES_DS` if resolution is awkward.
Pin the `Notion-Version` header in one constant.

Hits properties: Name, Week start, Valid from/to, Price, Førpris, Unit price,
Unit (kr/kg, kr/l, kr/stk), Pack, Discount, Deal note, Member, Source, Chain
(relation), Staple (relation).
Staples properties: Name, Active, Group (dairy, bread, grains, produce,
protein, drinks, household, other), Aliases, Preferred pack, Notes, Hits.

### Mapping rules

1. Query hits; find the max `Week start`; keep rows with that value
   (query sorted desc, page size 100, follow `next_cursor`).
2. Resolve `Chain` relation ids to names via one query of the Chains DB
   (cached per run). Resolve `Staple` relation ids via the Staples query.
3. Section of a hit = Group of its linked Staple; no Staple link => `other`.
4. Staples query: `Active = true`. Any active staple with no hit this week
   goes to the final section `staples-no-deal` ("Staples (no deal)"), item
   name = staple name, pack = `Preferred pack`, other fields null.
5. Section order: fixed Group order above, then `staples-no-deal`. Drop
   empty sections. Items sorted by name (`nb` locale) for a stable hash.
6. Item `id` = Notion page id without dashes (stable across weeks for staples,
   per-hit for deals). `price` is `Price`; `Førpris` is not exported unless
   the open question below says otherwise.
7. `list_hash` = sha256 over canonical JSON of `{week_start, sections}`,
   first 16 hex chars. `synced_at` is excluded so unchanged data produces no
   diff and no commit.

## 3. `list.json` shape

```json
{
  "version": 1,
  "week_start": "2026-10-26",
  "synced_at": "2026-11-01T06:10:04Z",
  "list_hash": "9f2c1ab47d03e8a5",
  "sections": [
    {
      "id": "dairy",
      "title": "Dairy",
      "items": [
        {
          "id": "1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6",
          "name": "Tine Lettmelk 1,5 l",
          "pack": "1,5 l",
          "price": 24.9,
          "unit_price": 16.6,
          "unit": "kr/l",
          "chain": "Kiwi",
          "discount": "-20%",
          "member": false,
          "note": "Max 4 per kunde"
        }
      ]
    },
    {
      "id": "staples-no-deal",
      "title": "Staples (no deal)",
      "items": [
        { "id": "7e8f…", "name": "Egg", "pack": "12-pk", "price": null,
          "unit_price": null, "unit": null, "chain": null,
          "discount": null, "member": false, "note": null }
      ]
    }
  ]
}
```

`version` bumps on breaking shape changes; the client rejects unknown major
versions and keeps the cached copy. Missing values are `null`, never absent.

## 4. Sync decision: systemd user timer (chosen)

| | systemd user timer on joakimarchy | Scheduled GitHub Action |
| --- | --- | --- |
| Cost | none | none while the repo is public (standard runners are free there); would use Actions minutes if the repo went private |
| Reliability | `Persistent=true` catches up after sleep/off | cron can be delayed or skipped; auto-disabled after 60 days of repo inactivity |
| Secret | local file, chmod 600 | repo secret, exposed to workflow code |
| Consistency | same pattern as hardcover-notion-sync | new pattern |
| Downside | needs the machine on | none |

**Pick the timer.** Keep `.github/workflows/sync.yml` as a
`workflow_dispatch`-only fallback using a `NOTION_TOKEN` repo secret; it runs
the same script and commits via `GITHUB_TOKEN` (needs `contents: write`).
Leave it manual so it never double-commits with the timer.

### Local installation (mirrors hardcover-notion-sync)

- Code copied to `~/.local/grocery-list/` by `scripts/install.sh` (idempotent;
  never touches `~/.config/grocery-list/env`). The sync works in a clone at
  `~/.local/grocery-list/repo` (separate from `~/src/grocery-list` so a dev
  checkout is never reset or dirtied).
- Env file `~/.config/grocery-list/env`, mode 600:
  `NOTION_TOKEN=…`, optionally the DB-id overrides.
- Units `grocery-list-sync.service` + `.timer` in `~/.config/systemd/user/`.
  Timer: weekly entry is on a known day, so run daily at 08:30 Europe/Oslo with
  `Persistent=true` (08:10 and 08:20 are taken by Garmin and Hardcover).
  `systemctl --user enable --now grocery-list-sync.timer`.
- Service: `git pull --ff-only`, run sync, then `git add public/list.json`,
  commit `chore: sync list (week <date>)` only if `git diff --quiet` fails,
  `git push`. Push failures exit non-zero so the unit shows as failed.

### Script behaviour

Language: Node + TS (same toolchain as the app, so the mapper is shared with
vitest and no second runtime). Entry `scripts/sync.ts`, built to
`dist-sync/sync.mjs` for the installed copy.

- `NOTION_TOKEN` unset or empty: print `NOTION_TOKEN missing: set it in
  ~/.config/grocery-list/env` to stderr, exit 2, **do not open or write
  list.json**.
- `--sample`: no network or token; write the bundled fixture-derived sample.
- `--dry-run`: fetch and map, print JSON to stdout, write nothing.
- Write is atomic (temp file + rename). If the mapped result is empty
  (zero hits and zero staples) exit non-zero rather than wiping the list.
- If `list_hash` equals the existing file's, leave the file alone (no
  `synced_at` churn).
- Never log the token; redact `Authorization` in any error output.

## 5. App (Vite + TS, no framework, like ls9-flashcards)

```
index.html  src/main.ts  src/state.ts  src/render.ts  src/style.css
src/types.ts  sync/map.ts (Notion -> list.json, shared)  scripts/sync.ts
public/list.json  public/manifest.webmanifest  public/sw.js
public/icons/{icon-192,icon-512,maskable-512,apple-touch-180}.png
```

- `vite.config.ts`: `base: '/grocery-list/'`. All asset and fetch URLs are
  relative to `import.meta.env.BASE_URL`.
- Grouped sections with collapsible headers and a per-section "n/m" count.
  Item row: checkbox, name, pack, price, unit price, chain, discount badge,
  "Member" tag when `member`, note beneath.
- Tap a row to check it off (large touch target, strike-through, checked items
  sink to the bottom of their section). State in `localStorage` under
  `grocery-list:checked:<list_hash>` as an array of item ids. On load, delete
  keys for other hashes (reset when the hash changes).
- Header shows "Synced <relative time> · week of <date>" from `synced_at`.
- Refresh button: `fetch(url + '?t=' + Date.now(), { cache: 'no-store' })`;
  on success re-render and update the cached copy; on failure show a toast
  and keep the current list.
- Offline: service worker precaches the shell; `list.json` is
  network-first with fallback to the last cached copy. Cache name includes a
  build version so old shells are purged on activate. The page also keeps the
  last good JSON in `localStorage` as a second fallback.
- PWA: manifest (`name`, `short_name`, `start_url`/`scope` `/grocery-list/`,
  `display: standalone`, theme colour, icons incl. maskable). iPhone Safari
  needs `apple-touch-icon`, `apple-mobile-web-app-capable`, status-bar meta
  and `viewport-fit=cover` with safe-area padding. Add to Home Screen via Share
  menu; no install prompt on iOS, so the README documents it.
- Accessibility: real `<button>`/`role=checkbox` semantics, 44 px targets,
  prefers-color-scheme dark mode.

## 6. Hosting

`.github/workflows/pages.yml`: on push to `main` (and manual), `npm ci`,
`npm run build`, `actions/upload-pages-artifact` (`dist`),
`actions/deploy-pages`; permissions `pages: write`, `id-token: write`;
concurrency group `pages`. The sync's commit to `main` triggers it, so the
site updates within a minute or two. Site URL:
`https://licensedsaucer9-web.github.io/grocery-list/`.

## 7. Tests and CI

- vitest, fixtures in `test/fixtures/` (recorded, scrubbed Notion API JSON for
  hits, staples, chains):
  - mapper: latest week selection, chain/staple relation resolution, unlinked
    hit goes to `other`, active staple without hit lands in
    `staples-no-deal`, inactive staple omitted, empty sections dropped,
    null handling, exported fields are only the allowlist, hash stable under
    reordering and unaffected by `synced_at`.
  - UI logic (`state.ts`): checked set keyed by hash, reset on hash change,
    toggle, section counts, relative-time formatting, version rejection.
  - sync CLI: missing token exits non-zero with message and leaves a
    pre-existing list.json byte-identical; `--sample` works without a token.
- `.github/workflows/ci.yml`, workflow `name: ci`, job id `ci`: on PR and
  push; `npm ci`, `npm test`, `npm run build`. Use `ci` as the required check
  name.

## 8. Seed data and README

Commit a hand-written `public/list.json` (a few dairy/produce/protein hits,
one member deal, a staples-no-deal section, fake-but-plausible values) so the
site works before any sync. `--sample` regenerates it. README covers: what it
is, the public-data warning, architecture, env vars, setup steps below,
`npm run dev|test|build|sync`, timer install and troubleshooting
(`journalctl --user -u grocery-list-sync`), and the iPhone install steps.

## 9. Joakim's manual steps

1. Notion: Settings > Connections > Develop or manage integrations > new
   **internal** integration, read content capability only. Copy the secret.
2. Share the three databases (Weekly hits, Staples, Chains) with the
   integration via each DB's "..." > Connections. Sharing the parent page
   "Grocery deals" covers all three if they sit under it.
3. `mkdir -p ~/.config/grocery-list && install -m 600 /dev/null
   ~/.config/grocery-list/env`, then add `NOTION_TOKEN=…`.
4. Run `scripts/install.sh`, then
   `systemctl --user enable --now grocery-list-sync.timer`; test once with
   `systemctl --user start grocery-list-sync.service`.
5. Repo Settings > Pages > Source = **GitHub Actions**.
6. (Fallback only) add `NOTION_TOKEN` repo secret.
7. On the iPhone: open the URL in Safari > Share > Add to Home Screen.

## 10. Phases

1. **Scaffold**: Vite + TS + vitest, tsconfig, `ci.yml`, `pages.yml`, seed
   `list.json`, manifest and icons. Pages live with sample data.
2. **UI**: render, check-off with hash-keyed storage, synced time, refresh,
   service worker and offline; state tests.
3. **Mapper + CLI**: fixtures, `map.ts`, `sync.ts` with `--sample`,
   `--dry-run`, missing-token behaviour; tests.
4. **Sync install**: `install.sh`, systemd units, README, fallback
   workflow; first real sync after Joakim's steps 1-4.
5. **Polish**: iPhone testing, icon refinement, timer-run observation over a
   full week.

Each phase is one PR into `main`.

## 11. Open questions

- Is the hits `Week start` always set on entry day, or could a late partial
  week need a "most recent with at least N rows" rule?
- Export `Førpris` (old price) and the validity dates, or only `discount`?
  Validity dates may matter for the "this week" banner.
- Chain relation can hold several stores per hit: join names, or one item per
  chain?
- Should staples with a hit also keep a staples row, or is the deal row
  enough? (Plan: deal row only.)
- Is publishing store prices and shopping habits publicly acceptable, or should
  the repo/site move behind a private host later (GitHub Pro, Cloudflare
  Access)?
- Timer time of day and whether a second weekday run is wanted when deals are
  entered late.
- Group order and Norwegian vs English section titles.
