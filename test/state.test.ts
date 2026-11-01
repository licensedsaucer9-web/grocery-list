import { describe, expect, it } from 'vitest';
import {
  checkedKey,
  formatPrice,
  formatUnitPrice,
  formatWeek,
  loadChecked,
  loadLastList,
  orderItems,
  parseList,
  relativeTime,
  saveChecked,
  saveLastList,
  sectionCount,
  toggle,
} from '../src/state.ts';
import type { GroceryList, Item, Section } from '../src/types.ts';
import { MemoryStorage } from './helpers.ts';

const item = (id: string): Item => ({
  id,
  name: id,
  pack: null,
  price: null,
  unit_price: null,
  unit: null,
  chain: null,
  discount: null,
  member: false,
  note: null,
});

const list = (hash = 'aaaa000000000000'): GroceryList => ({
  version: 1,
  week_start: '2026-10-26',
  synced_at: '2026-11-01T06:10:04Z',
  list_hash: hash,
  sections: [{ id: 'dairy', title: 'Dairy', items: [item('a'), item('b'), item('c')] }],
});

describe('checked state', () => {
  it('is keyed by list_hash', () => {
    const s = new MemoryStorage();
    saveChecked(s, 'h1', new Set(['a', 'b']));
    expect(s.getItem(checkedKey('h1'))).toBe('["a","b"]');
    expect(checkedKey('h1')).toBe('grocery-list:checked:h1');
    expect(loadChecked(s, 'h1')).toEqual(new Set(['a', 'b']));
  });

  it('resets when the hash changes and purges old keys', () => {
    const s = new MemoryStorage();
    saveChecked(s, 'old', new Set(['a']));
    s.setItem('unrelated', 'x');
    expect(loadChecked(s, 'new')).toEqual(new Set());
    expect(s.keys()).toEqual(['unrelated']);
  });

  it('tolerates corrupt storage', () => {
    const s = new MemoryStorage();
    s.setItem(checkedKey('h'), '{nope');
    expect(loadChecked(s, 'h')).toEqual(new Set());
  });

  it('toggles without mutating the input', () => {
    const start = new Set(['a']);
    expect(toggle(start, 'b')).toEqual(new Set(['a', 'b']));
    expect(toggle(start, 'a')).toEqual(new Set());
    expect(start).toEqual(new Set(['a']));
  });
});

describe('sections', () => {
  const section: Section = list().sections[0];

  it('counts checked items', () => {
    expect(sectionCount(section, new Set())).toEqual({ done: 0, total: 3 });
    expect(sectionCount(section, new Set(['b', 'zzz']))).toEqual({ done: 1, total: 3 });
  });

  it('sinks checked items to the bottom, keeping order', () => {
    expect(orderItems(section.items, new Set(['a'])).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(orderItems(section.items, new Set()).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatting', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const ago = (secs: number) => new Date(now.getTime() - secs * 1000);

  it('formats relative time', () => {
    expect(relativeTime(ago(10), now)).toBe('just now');
    expect(relativeTime(ago(-30), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60), now)).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3600), now)).toBe('3 h ago');
    expect(relativeTime(ago(30 * 3600), now)).toBe('yesterday');
    expect(relativeTime(ago(4 * 86400), now)).toBe('4 days ago');
    expect(relativeTime(ago(8 * 86400), now)).toBe('1 week ago');
    expect(relativeTime(ago(15 * 86400), now)).toBe('2 weeks ago');
    expect(relativeTime(new Date('nope'), now)).toBe('unknown');
  });

  it('formats week and prices', () => {
    expect(formatWeek('2026-10-26')).toBe('26 Oct');
    expect(formatWeek(null)).toBeNull();
    expect(formatPrice(24.9)?.replace(/\s/g, ' ')).toBe('24,90 kr');
    expect(formatPrice(null)).toBeNull();
    expect(formatUnitPrice(16.6, 'kr/l')).toBe('16,60 kr/l');
    expect(formatUnitPrice(null, 'kr/l')).toBeNull();
  });
});

describe('parseList', () => {
  it('accepts version 1', () => {
    expect(parseList(list()).list_hash).toBe('aaaa000000000000');
  });

  it('rejects unknown major versions and malformed data', () => {
    expect(() => parseList({ ...list(), version: 2 })).toThrow(/version/);
    expect(() => parseList({ ...list(), version: undefined })).toThrow(/version/);
    expect(() => parseList(null)).toThrow();
    expect(() => parseList({ version: 1, list_hash: 'x' })).toThrow(/sections/);
    expect(() => parseList({ ...list(), sections: [{ id: 'x' }] })).toThrow(/section/);
  });

  it('keeps the cached copy when a newer version is rejected', () => {
    const s = new MemoryStorage();
    saveLastList(s, list('cached'));
    expect(() => parseList({ ...list('next'), version: 2 })).toThrow();
    expect(loadLastList(s)?.list_hash).toBe('cached');
  });
});
