import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseList } from '../src/state.ts';

const SCRIPT = resolve(__dirname, '../scripts/sync.ts');

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'grocery-sync-'));
  const baseEnv = { ...process.env };
  delete baseEnv.NOTION_TOKEN;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
  });
  return { ...res, cwd };
}

describe('sync CLI', () => {
  it('exits non-zero with a clear message when NOTION_TOKEN is missing and leaves list.json byte-identical', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grocery-out-'));
    const out = join(dir, 'list.json');
    const original = '{"version":1,"keep":"me"}  \n';
    writeFileSync(out, original);
    for (const env of [{}, { NOTION_TOKEN: '' }, { NOTION_TOKEN: '   ' }]) {
      const res = run(['--out', out], env);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('NOTION_TOKEN missing');
      expect(readFileSync(out, 'utf8')).toBe(original);
    }
  });

  it('--sample works without a token and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grocery-out-'));
    const out = join(dir, 'list.json');
    const first = run(['--sample', '--out', out]);
    expect(first.status).toBe(0);
    const written = readFileSync(out, 'utf8');
    const list = parseList(JSON.parse(written));
    expect(list.week_start).toBe('2026-10-26');
    expect(list.sections.at(-1)?.id).toBe('staples-no-deal');

    const second = run(['--sample', '--out', out]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('unchanged');
    expect(readFileSync(out, 'utf8')).toBe(written);
  });

  it('--sample --dry-run prints JSON and writes nothing', () => {
    const res = run(['--sample', '--dry-run']);
    expect(res.status).toBe(0);
    expect(parseList(JSON.parse(res.stdout)).sections.length).toBeGreaterThan(0);
    expect(() => readFileSync(join(res.cwd, 'public/list.json'))).toThrow();
  });
});
