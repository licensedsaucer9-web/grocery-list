import { describe, expect, it } from 'vitest';
import { configFromEnv, DEFAULT_DBS, fetchAll, NOTION_VERSION, redact } from '../sync/notion.ts';
import { buildList } from '../sync/map.ts';
import { fixtureInput } from './helpers.ts';

describe('notion client', () => {
  it('reads config from env with plan defaults', () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ NOTION_TOKEN: ' ' })).toBeNull();
    expect(configFromEnv({ NOTION_TOKEN: 'ntn_x' })).toMatchObject({
      token: 'ntn_x',
      hitsDb: DEFAULT_DBS.hits,
      staplesDb: DEFAULT_DBS.staples,
      chainsDb: DEFAULT_DBS.chains,
    });
  });

  it('redacts tokens and Authorization headers', () => {
    const msg = redact('Authorization: Bearer ntn_abc123 failed for secret_xyz and tok', 'tok');
    expect(msg).not.toMatch(/ntn_abc123|secret_xyz|\btok\b/);
  });

  it('resolves data sources, pages, and maps fixtures end to end', async () => {
    const fx = fixtureInput();
    const calls: { url: string; init: RequestInit }[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const db = url.match(/\/databases\/(\w+)$/);
      if (db) return json({ data_sources: [{ id: `ds-${db[1]}` }] });
      const body = JSON.parse(String(init.body));
      if (url.includes(`ds-${DEFAULT_DBS.hits}`)) {
        // Two pages to exercise next_cursor.
        return body.start_cursor
          ? json({ results: fx.hits.slice(3), has_more: false, next_cursor: null })
          : json({ results: fx.hits.slice(0, 3), has_more: true, next_cursor: 'c2' });
      }
      if (url.includes(`ds-${DEFAULT_DBS.staples}`)) return json({ results: fx.staples, has_more: false, next_cursor: null });
      return json({ results: fx.chains, has_more: false, next_cursor: null });
    }) as unknown as typeof fetch;

    const input = await fetchAll(configFromEnv({ NOTION_TOKEN: 'ntn_x' })!, fakeFetch);
    expect(buildList(input).list_hash).toBe(buildList(fixtureInput()).list_hash);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Notion-Version']).toBe(NOTION_VERSION);
    expect(calls.every((c) => c.init.method === 'GET' || c.url.endsWith('/query'))).toBe(true);
  });

  it('surfaces HTTP errors without the token', async () => {
    const fakeFetch = (async () => new Response('{"message":"unauthorized ntn_secret"}', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchAll(configFromEnv({ NOTION_TOKEN: 'ntn_secret' })!, fakeFetch)).rejects.toThrow(/401/);
    await expect(fetchAll(configFromEnv({ NOTION_TOKEN: 'ntn_secret' })!, fakeFetch)).rejects.not.toThrow(/ntn_secret/);
  });
});
