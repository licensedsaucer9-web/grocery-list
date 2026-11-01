import './style.css';
import { renderList, type RenderState } from './render.ts';
import {
  formatWeek,
  loadChecked,
  loadCollapsed,
  loadLastList,
  parseList,
  relativeTime,
  saveChecked,
  saveCollapsed,
  saveLastList,
  toggle,
} from './state.ts';
import type { GroceryList } from './types.ts';

const BASE = import.meta.env.BASE_URL;
const LIST_URL = `${BASE}list.json`;

const root = document.querySelector<HTMLElement>('#list')!;
const status = document.querySelector<HTMLElement>('#status')!;
const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh')!;
const toastEl = document.querySelector<HTMLElement>('#toast')!;
const storage = window.localStorage;

let state: RenderState | null = null;

function updateStatus(): void {
  if (!state) return;
  const synced = new Date(state.list.synced_at);
  const week = formatWeek(state.list.week_start);
  status.textContent = `Synced ${relativeTime(synced)}${week ? ` · week of ${week}` : ''}`;
  status.title = synced.toLocaleString();
}

function draw(): void {
  if (!state) return;
  renderList(root, state, {
    onToggleItem(id) {
      if (!state) return;
      state.checked = toggle(state.checked, id);
      saveChecked(storage, state.list.list_hash, state.checked);
      draw();
    },
    onToggleSection(id) {
      if (!state) return;
      state.collapsed = toggle(state.collapsed, id);
      saveCollapsed(storage, state.collapsed);
      draw();
    },
  });
  updateStatus();
}

function show(list: GroceryList): void {
  const checked = loadChecked(storage, list.list_hash);
  state = { list, checked, collapsed: state?.collapsed ?? loadCollapsed(storage) };
  saveLastList(storage, list);
  draw();
}

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4000);
}

async function fetchList(bypassCache: boolean): Promise<{ list: GroceryList; offline: boolean }> {
  const url = bypassCache ? `${LIST_URL}?t=${Date.now()}` : LIST_URL;
  const res = await fetch(url, bypassCache ? { cache: 'no-store' } : {});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Set by sw.js when the network failed and it served the cached copy.
  const offline = res.headers.get('X-Grocery-Offline') === '1';
  return { list: parseList(await res.json()), offline };
}

async function load(bypassCache: boolean): Promise<void> {
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  try {
    const { list, offline } = await fetchList(bypassCache);
    show(list);
    if (offline) toast('Offline. Showing saved list.');
    else if (bypassCache) toast('List is up to date');
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (state) toast(`Could not refresh (${why}). Showing saved list.`);
    else root.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: `Could not load the list (${why}).` }));
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
}

refreshBtn.addEventListener('click', () => void load(true));
window.setInterval(updateStatus, 60_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && updateStatus());

// Paint the last good copy straight away, then ask the network.
const last = loadLastList(storage);
if (last) show(last);
void load(false);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {});
  });
}
