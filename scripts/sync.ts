// Notion -> public/list.json. See docs/plans/grocery-list.md section 4.
//   node scripts/sync.ts            fetch, map, write if list_hash changed
//   node scripts/sync.ts --dry-run  fetch, map, print JSON, write nothing
//   node scripts/sync.ts --sample   no token/network, write fixture sample
//   --out <path>                    target file (default public/list.json)
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildList, itemCount, type MapInput } from '../sync/map.ts';
import { configFromEnv, fetchAll, redact } from '../sync/notion.ts';
import type { GroceryList } from '../src/types.ts';
import hitsFixture from '../test/fixtures/hits.json' with { type: 'json' };
import staplesFixture from '../test/fixtures/staples.json' with { type: 'json' };
import chainsFixture from '../test/fixtures/chains.json' with { type: 'json' };

export const MISSING_TOKEN = 'NOTION_TOKEN missing: set it in ~/.config/grocery-list/env';

export function sampleInput(): MapInput {
  return {
    hits: hitsFixture.results as unknown as MapInput['hits'],
    staples: staplesFixture.results as unknown as MapInput['staples'],
    chains: chainsFixture.results as unknown as MapInput['chains'],
  };
}

function readExistingHash(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as Partial<GroceryList>).list_hash ?? null;
  } catch {
    return null;
  }
}

function writeIfChanged(path: string, list: GroceryList): boolean {
  if (readExistingHash(path) === list.list_hash) return false;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  renameSync(tmp, path);
  return true;
}

async function main(argv: string[]): Promise<number> {
  const sample = argv.includes('--sample');
  const dryRun = argv.includes('--dry-run');
  const outIdx = argv.indexOf('--out');
  const out = resolve(outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : 'public/list.json');

  let input: MapInput;
  let token: string | undefined;
  if (sample) {
    input = sampleInput();
  } else {
    const cfg = configFromEnv(process.env);
    if (!cfg) {
      console.error(MISSING_TOKEN);
      return 2;
    }
    token = cfg.token;
    try {
      input = await fetchAll(cfg);
    } catch (err) {
      console.error(redact(`sync failed: ${err instanceof Error ? err.message : String(err)}`, token));
      return 1;
    }
  }

  const list = buildList(input);
  if (itemCount(list) === 0) {
    console.error('sync produced an empty list (no hits and no active staples); refusing to overwrite list.json');
    return 3;
  }
  if (dryRun) {
    process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    return 0;
  }
  const changed = writeIfChanged(out, list);
  console.log(
    changed
      ? `wrote ${out} (week ${list.week_start}, ${itemCount(list)} items, hash ${list.list_hash})`
      : `unchanged (hash ${list.list_hash})`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(redact(`sync crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`, process.env.NOTION_TOKEN));
    process.exit(1);
  },
);
