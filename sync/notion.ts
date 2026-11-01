// Tiny read-only Notion client. Only GET database + POST data source query.
import type { NotionPage } from './map.ts';

export const NOTION_VERSION = '2025-09-03';
const API = 'https://api.notion.com/v1';

export interface NotionConfig {
  token: string;
  hitsDb: string;
  staplesDb: string;
  chainsDb: string;
  hitsDs?: string;
  staplesDs?: string;
  chainsDs?: string;
}

export const DEFAULT_DBS = {
  hits: '75cc9f4d981846be9c5d91f6a98f6b82',
  staples: '4fa7eec1a1ae4ecdbee62309922edea2',
  chains: '2a12d05774d44d9caa51b65294ad4c39',
};

export function configFromEnv(env: NodeJS.ProcessEnv): NotionConfig | null {
  const token = env.NOTION_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    hitsDb: env.NOTION_HITS_DB?.trim() || DEFAULT_DBS.hits,
    staplesDb: env.NOTION_STAPLES_DB?.trim() || DEFAULT_DBS.staples,
    chainsDb: env.NOTION_CHAINS_DB?.trim() || DEFAULT_DBS.chains,
    hitsDs: env.NOTION_HITS_DS?.trim() || undefined,
    staplesDs: env.NOTION_STAPLES_DS?.trim() || undefined,
    chainsDs: env.NOTION_CHAINS_DS?.trim() || undefined,
  };
}

// Strip anything that looks like a credential from text bound for logs.
export function redact(text: string, token?: string): string {
  let out = text.replace(/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, '$1[REDACTED]');
  out = out.replace(/bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]');
  out = out.replace(/\b(secret_|ntn_)[A-Za-z0-9]+/g, '[REDACTED]');
  if (token) out = out.split(token).join('[REDACTED]');
  return out;
}

type Fetch = typeof fetch;

export class NotionClient {
  private readonly token: string;
  private readonly fetchImpl: Fetch;

  constructor(token: string, fetchImpl: Fetch = fetch) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(redact(`Notion ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`, this.token));
    }
    return (await res.json()) as T;
  }

  async dataSourceId(databaseId: string): Promise<string> {
    const db = await this.request<{ data_sources?: { id: string }[] }>('GET', `/databases/${databaseId}`);
    const id = db.data_sources?.[0]?.id;
    if (!id) throw new Error(`database ${databaseId} has no data sources (is it shared with the integration?)`);
    return id;
  }

  // Query a data source, following next_cursor. `stop` can end paging early.
  async queryAll(
    dataSourceId: string,
    body: Record<string, unknown> = {},
    stop?: (pages: NotionPage[]) => boolean,
  ): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.request<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
        'POST',
        `/data_sources/${dataSourceId}/query`,
        { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
      );
      pages.push(...res.results);
      cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
      if (stop?.(pages)) break;
    } while (cursor);
    return pages;
  }
}

const weekOf = (p: NotionPage): string | null => {
  const prop = p.properties['Week start'] as { type: string; date?: { start?: string } | null } | undefined;
  return prop?.type === 'date' ? (prop.date?.start?.slice(0, 10) ?? null) : null;
};

export async function fetchAll(cfg: NotionConfig, fetchImpl: Fetch = fetch) {
  const client = new NotionClient(cfg.token, fetchImpl);
  const [hitsDs, staplesDs, chainsDs] = await Promise.all([
    cfg.hitsDs ?? client.dataSourceId(cfg.hitsDb),
    cfg.staplesDs ?? client.dataSourceId(cfg.staplesDb),
    cfg.chainsDs ?? client.dataSourceId(cfg.chainsDb),
  ]);
  const [hits, staples, chains] = await Promise.all([
    // Sorted newest week first; stop once a page reaches an older week.
    client.queryAll(
      hitsDs,
      { sorts: [{ property: 'Week start', direction: 'descending' }] },
      (pages) => {
        const first = pages.find((p) => weekOf(p) !== null);
        const last = pages[pages.length - 1];
        return !!first && !!last && weekOf(last) !== null && weekOf(last)! < weekOf(first)!;
      },
    ),
    // All staples: group lookup needs inactive ones too; map.ts filters Active.
    client.queryAll(staplesDs),
    client.queryAll(chainsDs),
  ]);
  return { hits, staples, chains };
}
