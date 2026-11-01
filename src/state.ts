// Pure UI logic: checked-state storage, counts, formatting, validation.
import { LIST_VERSION, type GroceryList, type Item, type Section } from './types.ts';

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export const CHECKED_PREFIX = 'grocery-list:checked:';
export const LAST_LIST_KEY = 'grocery-list:last';
export const COLLAPSED_KEY = 'grocery-list:collapsed';

export const checkedKey = (hash: string): string => `${CHECKED_PREFIX}${hash}`;

function readIdSet(storage: KV, key: string): Set<string> {
  try {
    const raw = storage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

// Load checked ids for this list and drop keys belonging to other hashes,
// so a new list (new hash) always starts unchecked.
export function loadChecked(storage: KV, hash: string): Set<string> {
  const keep = checkedKey(hash);
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(CHECKED_PREFIX) && k !== keep) stale.push(k);
  }
  stale.forEach((k) => storage.removeItem(k));
  return readIdSet(storage, keep);
}

export function saveChecked(storage: KV, hash: string, checked: Set<string>): void {
  storage.setItem(checkedKey(hash), JSON.stringify([...checked]));
}

export function toggle(checked: Set<string>, id: string): Set<string> {
  const next = new Set(checked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function loadCollapsed(storage: KV): Set<string> {
  return readIdSet(storage, COLLAPSED_KEY);
}

export function saveCollapsed(storage: KV, collapsed: Set<string>): void {
  storage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

export function sectionCount(section: Section, checked: Set<string>): { done: number; total: number } {
  const done = section.items.filter((i) => checked.has(i.id)).length;
  return { done, total: section.items.length };
}

// Unchecked first, checked sink to the bottom; original order otherwise kept.
export function orderItems(items: Item[], checked: Set<string>): Item[] {
  return [...items.filter((i) => !checked.has(i.id)), ...items.filter((i) => checked.has(i.id))];
}

export function relativeTime(then: Date, now: Date = new Date()): string {
  const secs = Math.round((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(secs)) return 'unknown';
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

export function formatWeek(weekStart: string | null): string | null {
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const d = new Date(`${weekStart}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const kr = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPrice(value: number | null): string | null {
  return value === null ? null : `${kr.format(value)} kr`;
}

export function formatUnitPrice(value: number | null, unit: string | null): string | null {
  if (value === null) return null;
  return unit ? `${kr.format(value)} ${unit}` : kr.format(value);
}

export class ListError extends Error {}

// Accept only list.json with a known major version and the expected shape.
export function parseList(data: unknown): GroceryList {
  if (!data || typeof data !== 'object') throw new ListError('list.json is not an object');
  const d = data as Partial<GroceryList>;
  if (typeof d.version !== 'number' || Math.floor(d.version) !== LIST_VERSION) {
    throw new ListError(`unsupported list.json version ${String(d.version)}`);
  }
  if (typeof d.list_hash !== 'string' || !Array.isArray(d.sections)) {
    throw new ListError('list.json is missing list_hash or sections');
  }
  for (const s of d.sections) {
    if (!s || typeof s.id !== 'string' || typeof s.title !== 'string' || !Array.isArray(s.items)) {
      throw new ListError('list.json has a malformed section');
    }
  }
  return d as GroceryList;
}

export function loadLastList(storage: KV): GroceryList | null {
  try {
    const raw = storage.getItem(LAST_LIST_KEY);
    return raw ? parseList(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLastList(storage: KV, list: GroceryList): void {
  try {
    storage.setItem(LAST_LIST_KEY, JSON.stringify(list));
  } catch {
    // Quota or private mode: the service worker cache is the other fallback.
  }
}
