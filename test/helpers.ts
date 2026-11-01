import type { MapInput, NotionPage } from '../sync/map.ts';
import hits from './fixtures/hits.json' with { type: 'json' };
import staples from './fixtures/staples.json' with { type: 'json' };
import chains from './fixtures/chains.json' with { type: 'json' };

export function fixtureInput(): MapInput {
  // Deep copy so tests can mutate freely.
  return structuredClone({
    hits: hits.results as unknown as NotionPage[],
    staples: staples.results as unknown as NotionPage[],
    chains: chains.results as unknown as NotionPage[],
  });
}

export function byName(pages: NotionPage[], name: string): NotionPage {
  const page = pages.find((p) => {
    const title = p.properties.Name as unknown as { title: { plain_text: string }[] };
    return title.title.map((t) => t.plain_text).join('') === name;
  });
  if (!page) throw new Error(`no fixture page named ${name}`);
  return page;
}

export class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  keys() {
    return [...this.map.keys()];
  }
}
