import { describe, expect, it } from 'vitest';
import { buildList, latestWeek, listHash, mapSections } from '../sync/map.ts';
import { byName, fixtureInput } from './helpers.ts';

const ITEM_KEYS = ['chain', 'discount', 'id', 'member', 'name', 'note', 'pack', 'price', 'unit', 'unit_price'];

const allItems = (input = fixtureInput()) => mapSections(input).sections.flatMap((s) => s.items);
const find = (name: string, input = fixtureInput()) => allItems(input).find((i) => i.name === name);

describe('mapSections', () => {
  it('keeps only hits from the latest week', () => {
    const input = fixtureInput();
    expect(latestWeek(input.hits)).toBe('2026-10-26');
    const { week_start } = mapSections(input);
    expect(week_start).toBe('2026-10-26');
    const names = allItems(input).map((i) => i.name);
    expect(names).not.toContain('Gammel melk-deal');
    expect(names).not.toContain('Gammel egg-deal');
    expect(names).toContain('Tine Lettmelk 1,5 l');
  });

  it('resolves chain relations to names (joined) and staple relations to groups', () => {
    const milk = find('Tine Lettmelk 1,5 l')!;
    expect(milk.chain).toBe('Kiwi');
    expect(find('Bananer')!.chain).toBe('Rema 1000, Meny');
    const { sections } = mapSections(fixtureInput());
    expect(sections.find((s) => s.id === 'dairy')!.items.map((i) => i.name)).toEqual(['Tine Lettmelk 1,5 l']);
    expect(sections.find((s) => s.id === 'protein')!.items.map((i) => i.name)).toEqual(['Kyllingfilet 1 kg']);
  });

  it('puts hits without a staple link in other', () => {
    const other = mapSections(fixtureInput()).sections.find((s) => s.id === 'other')!;
    expect(other.items.map((i) => i.name)).toEqual(['Avokado 2-pk', 'Kaffe 500 g']);
  });

  it('lists active staples without a hit in staples-no-deal, last', () => {
    const { sections } = mapSections(fixtureInput());
    const last = sections[sections.length - 1];
    expect(last.id).toBe('staples-no-deal');
    expect(last.title).toBe('Staples (no deal)');
    expect(last.items.map((i) => i.name)).toEqual(['Egg', 'Grovbrød', 'Havregryn']);
    const egg = last.items.find((i) => i.name === 'Egg')!;
    expect(egg).toEqual({
      id: egg.id,
      name: 'Egg',
      pack: '12-pk',
      price: null,
      unit_price: null,
      unit: null,
      chain: null,
      discount: null,
      member: false,
      note: null,
    });
    expect(egg.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('omits inactive staples and staples that have a deal row', () => {
    const names = allItems().map((i) => i.name);
    expect(names).not.toContain('Farris');
    expect(names).not.toContain('Dopapir');
    expect(names).not.toContain('Lettmelk');
    expect(names).not.toContain('Kyllingfilet');
  });

  it('drops empty sections and keeps the fixed group order', () => {
    const ids = mapSections(fixtureInput()).sections.map((s) => s.id);
    expect(ids).toEqual(['dairy', 'produce', 'protein', 'other', 'staples-no-deal']);
  });

  it('maps values and uses null for missing ones', () => {
    const milk = find('Tine Lettmelk 1,5 l')!;
    expect(milk).toMatchObject({ price: 24.9, unit_price: 16.6, unit: 'kr/l', pack: '1,5 l', discount: '-20%', member: false, note: 'Max 4 per kunde' });
    expect(find('Kyllingfilet 1 kg')!).toMatchObject({ member: true, discount: '-30%' });
    expect(find('Kaffe 500 g')!).toMatchObject({ price: null, unit_price: null, unit: null, pack: null, chain: null, discount: null, note: null });
  });

  it('uses the Notion page id without dashes as item id', () => {
    const input = fixtureInput();
    const page = byName(input.hits, 'Tine Lettmelk 1,5 l');
    expect(find('Tine Lettmelk 1,5 l', input)!.id).toBe(page.id.replace(/-/g, ''));
  });

  it('exports only allowlisted fields (no Source, Notes, Aliases, Førpris, URLs)', () => {
    const list = buildList(fixtureInput());
    expect(Object.keys(list).sort()).toEqual(['list_hash', 'sections', 'synced_at', 'version', 'week_start']);
    for (const section of list.sections) {
      expect(Object.keys(section).sort()).toEqual(['id', 'items', 'title']);
      for (const item of section.items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    }
    const text = JSON.stringify(list);
    expect(text).not.toMatch(/example\.invalid|notion\.so|PRIVATE|mjølk|31\.1/);
  });

  it('handles empty input', () => {
    expect(mapSections({ hits: [], staples: [], chains: [] })).toEqual({ week_start: null, sections: [] });
  });
});

describe('list_hash', () => {
  it('is 16 hex chars and stable under input reordering', () => {
    const a = fixtureInput();
    const b = fixtureInput();
    b.hits.reverse();
    b.staples.reverse();
    b.chains.reverse();
    const la = buildList(a);
    expect(la.list_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(buildList(b).list_hash).toBe(la.list_hash);
  });

  it('ignores synced_at', () => {
    const one = buildList(fixtureInput(), new Date('2026-11-01T06:00:00Z'));
    const two = buildList(fixtureInput(), new Date('2026-11-02T06:00:00Z'));
    expect(one.synced_at).not.toBe(two.synced_at);
    expect(one.list_hash).toBe(two.list_hash);
    expect(one.synced_at).toBe('2026-11-01T06:00:00Z');
  });

  it('changes when the content changes', () => {
    const { week_start, sections } = mapSections(fixtureInput());
    const before = listHash(week_start, sections);
    sections[0].items[0].price = 1;
    expect(listHash(week_start, sections)).not.toBe(before);
  });
});
