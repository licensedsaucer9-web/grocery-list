// Notion API responses -> list.json. Shared by scripts/sync.ts and tests.
// Only the allowlisted Item fields are ever emitted: no page URLs, Source,
// Notes or Aliases.
import { createHash } from 'node:crypto';
import { LIST_VERSION, type GroceryList, type Item, type Section } from '../src/types.ts';

export const GROUP_ORDER = [
  'dairy',
  'bread',
  'grains',
  'produce',
  'protein',
  'drinks',
  'household',
  'other',
] as const;

export const SECTION_TITLES: Record<string, string> = {
  dairy: 'Dairy',
  bread: 'Bread',
  grains: 'Grains',
  produce: 'Produce',
  protein: 'Protein',
  drinks: 'Drinks',
  household: 'Household',
  other: 'Other',
  'staples-no-deal': 'Staples (no deal)',
};

// Minimal shape of a Notion page as returned by data source queries.
export interface NotionPage {
  object?: string;
  id: string;
  properties: Record<string, NotionProperty>;
  [key: string]: unknown;
}

export interface NotionProperty {
  type: string;
  [key: string]: unknown;
}

export interface MapInput {
  hits: NotionPage[];
  staples: NotionPage[];
  chains: NotionPage[];
}

const compactId = (id: string): string => id.replace(/-/g, '');

function richText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .map((part) => (part && typeof part.plain_text === 'string' ? part.plain_text : ''))
    .join('')
    .trim();
  return text === '' ? null : text;
}

export function propText(page: NotionPage, name: string): string | null {
  const prop = page.properties[name];
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return richText(prop.title);
    case 'rich_text':
      return richText(prop.rich_text);
    case 'select': {
      const sel = prop.select as { name?: string } | null;
      return sel?.name?.trim() || null;
    }
    case 'status': {
      const st = prop.status as { name?: string } | null;
      return st?.name?.trim() || null;
    }
    case 'number':
      return typeof prop.number === 'number' ? String(prop.number) : null;
    case 'formula': {
      const f = prop.formula as { type?: string; string?: string | null; number?: number | null } | null;
      if (f?.type === 'string') return f.string?.trim() || null;
      if (f?.type === 'number' && typeof f.number === 'number') return String(f.number);
      return null;
    }
    default:
      return null;
  }
}

export function propNumber(page: NotionPage, name: string): number | null {
  const prop = page.properties[name];
  if (!prop) return null;
  if (prop.type === 'number') return typeof prop.number === 'number' ? prop.number : null;
  if (prop.type === 'formula') {
    const f = prop.formula as { type?: string; number?: number | null } | null;
    return f?.type === 'number' && typeof f.number === 'number' ? f.number : null;
  }
  return null;
}

export function propBool(page: NotionPage, name: string): boolean {
  const prop = page.properties[name];
  return prop?.type === 'checkbox' ? prop.checkbox === true : false;
}

export function propDate(page: NotionPage, name: string): string | null {
  const prop = page.properties[name];
  if (prop?.type !== 'date') return null;
  const d = prop.date as { start?: string } | null;
  return d?.start ? d.start.slice(0, 10) : null;
}

export function propRelation(page: NotionPage, name: string): string[] {
  const prop = page.properties[name];
  if (prop?.type !== 'relation' || !Array.isArray(prop.relation)) return [];
  return (prop.relation as { id: string }[]).map((r) => compactId(r.id));
}

// Discount may be a number (0.2 => -20%, or 20 => -20%) or free text.
function formatDiscount(page: NotionPage): string | null {
  const prop = page.properties['Discount'];
  if (!prop) return null;
  if (prop.type === 'number' || (prop.type === 'formula' && propNumber(page, 'Discount') !== null)) {
    const n = propNumber(page, 'Discount');
    if (n === null || n === 0) return null;
    const pct = Math.abs(n) <= 1 ? Math.round(Math.abs(n) * 100) : Math.round(Math.abs(n));
    return `-${pct}%`;
  }
  return propText(page, 'Discount');
}

const byName = (a: Item, b: Item): number =>
  a.name.localeCompare(b.name, 'nb') || a.id.localeCompare(b.id);

export function latestWeek(hits: NotionPage[]): string | null {
  let max: string | null = null;
  for (const hit of hits) {
    const w = propDate(hit, 'Week start');
    if (w && (max === null || w > max)) max = w;
  }
  return max;
}

export function mapSections(input: MapInput): { week_start: string | null; sections: Section[] } {
  const chainNames = new Map<string, string>();
  for (const chain of input.chains) {
    const name = propText(chain, 'Name');
    if (name) chainNames.set(compactId(chain.id), name);
  }

  const activeStaples = input.staples.filter((s) => propBool(s, 'Active'));
  const stapleGroup = new Map<string, string>();
  for (const staple of input.staples) {
    const group = propText(staple, 'Group')?.toLowerCase() ?? 'other';
    stapleGroup.set(compactId(staple.id), (GROUP_ORDER as readonly string[]).includes(group) ? group : 'other');
  }

  const week_start = latestWeek(input.hits);
  const weekHits = week_start === null ? [] : input.hits.filter((h) => propDate(h, 'Week start') === week_start);

  const buckets = new Map<string, Item[]>();
  const push = (section: string, item: Item) => {
    const list = buckets.get(section) ?? [];
    list.push(item);
    buckets.set(section, list);
  };

  const stapleHasHit = new Set<string>();
  for (const hit of weekHits) {
    const name = propText(hit, 'Name');
    if (!name) continue;
    const stapleIds = propRelation(hit, 'Staple');
    const stapleId = stapleIds.find((id) => stapleGroup.has(id));
    stapleIds.forEach((id) => stapleHasHit.add(id));
    const chain = propRelation(hit, 'Chain')
      .map((id) => chainNames.get(id))
      .filter((n): n is string => !!n)
      .join(', ');
    push(stapleId ? stapleGroup.get(stapleId)! : 'other', {
      id: compactId(hit.id),
      name,
      pack: propText(hit, 'Pack'),
      price: propNumber(hit, 'Price'),
      unit_price: propNumber(hit, 'Unit price'),
      unit: propText(hit, 'Unit'),
      chain: chain === '' ? null : chain,
      discount: formatDiscount(hit),
      member: propBool(hit, 'Member'),
      note: propText(hit, 'Deal note'),
    });
  }

  for (const staple of activeStaples) {
    const id = compactId(staple.id);
    const name = propText(staple, 'Name');
    if (!name || stapleHasHit.has(id)) continue;
    push('staples-no-deal', {
      id,
      name,
      pack: propText(staple, 'Preferred pack'),
      price: null,
      unit_price: null,
      unit: null,
      chain: null,
      discount: null,
      member: false,
      note: null,
    });
  }

  const sections: Section[] = [];
  for (const sid of [...GROUP_ORDER, 'staples-no-deal']) {
    const items = buckets.get(sid);
    if (!items || items.length === 0) continue;
    sections.push({ id: sid, title: SECTION_TITLES[sid], items: [...items].sort(byName) });
  }
  return { week_start, sections };
}

// Canonical JSON: object keys sorted recursively.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function listHash(week_start: string | null, sections: Section[]): string {
  return createHash('sha256').update(canonicalJson({ week_start, sections })).digest('hex').slice(0, 16);
}

export function buildList(input: MapInput, syncedAt: Date = new Date()): GroceryList {
  const { week_start, sections } = mapSections(input);
  return {
    version: LIST_VERSION,
    week_start,
    synced_at: syncedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    list_hash: listHash(week_start, sections),
    sections,
  };
}

export function itemCount(list: Pick<GroceryList, 'sections'>): number {
  return list.sections.reduce((n, s) => n + s.items.length, 0);
}
