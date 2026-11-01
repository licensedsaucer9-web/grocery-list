import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCOPE = 'https://example.test/grocery-list/';
const LIST_URL = `${SCOPE}list.json`;
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

type FetchHandler = (event: { request: Request; respondWith(p: Promise<Response>): void }) => void;

// Load sw.js in a sandbox with in-memory Cache Storage and a stub fetch.
function loadWorker(fetchImpl: (req: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async put(key: string, res: Response) {
          store.set(key, res);
        },
        async match(key: string) {
          return store.get(key)?.clone();
        },
      };
    },
  };
  const listeners = new Map<string, FetchHandler>();
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: FetchHandler) => listeners.set(type, fn),
  };
  const context = createContext({ self, caches, fetch: fetchImpl, URL, Headers, Response, Request });
  runInContext(source, context);

  async function get(url: string): Promise<Response> {
    let result: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: new Request(url), respondWith: (p) => (result = p) });
    if (!result) throw new Error('sw did not respond');
    return result;
  }
  return { get, caches };
}

const listBody = JSON.stringify({ week: '2026-W44' });

describe('sw.js list.json', () => {
  it('serves and caches the network copy when it is ok', async () => {
    const sw = loadWorker(async () => new Response(listBody, { status: 200 }));
    const res = await sw.get(LIST_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Grocery-Offline')).toBeNull();
    const cached = await (await sw.caches.open('grocery-list-data')).match(LIST_URL);
    expect(await cached!.text()).toBe(listBody);
  });

  it('falls back to the saved copy when fetch throws', async () => {
    let online = true;
    const sw = loadWorker(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(listBody, { status: 200 });
    });
    await sw.get(LIST_URL);
    online = false;
    const res = await sw.get(`${LIST_URL}?t=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Grocery-Offline')).toBe('1');
    expect(await res.text()).toBe(listBody);
  });

  it('falls back to the saved copy on an HTTP error', async () => {
    let status = 200;
    const sw = loadWorker(async () => new Response(status === 200 ? listBody : 'Bad Gateway', { status }));
    await sw.get(LIST_URL);
    status = 502;
    const res = await sw.get(`${LIST_URL}?t=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Grocery-Offline')).toBe('1');
    expect(await res.text()).toBe(listBody);
    // The error response must not overwrite the saved copy.
    const cached = await (await sw.caches.open('grocery-list-data')).match(LIST_URL);
    expect(await cached!.text()).toBe(listBody);
  });

  it('passes the HTTP error through when nothing is saved', async () => {
    const sw = loadWorker(async () => new Response('Not Found', { status: 404 }));
    const res = await sw.get(LIST_URL);
    expect(res.status).toBe(404);
  });

  it('rethrows the network error when nothing is saved', async () => {
    const sw = loadWorker(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(sw.get(LIST_URL)).rejects.toThrow('Failed to fetch');
  });
});
