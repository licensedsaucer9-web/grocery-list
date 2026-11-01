import { formatPrice, formatUnitPrice, orderItems, sectionCount } from './state.ts';
import type { GroceryList, Item, Section } from './types.ts';

export interface RenderState {
  list: GroceryList;
  checked: Set<string>;
  collapsed: Set<string>;
}

export interface RenderHandlers {
  onToggleItem(id: string): void;
  onToggleSection(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderItem(item: Item, checked: boolean, handlers: RenderHandlers): HTMLLIElement {
  const li = el('li');
  const btn = el('button', checked ? 'item checked' : 'item');
  btn.type = 'button';
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', String(checked));
  btn.dataset.id = item.id;
  btn.addEventListener('click', () => handlers.onToggleItem(item.id));

  btn.append(el('span', 'box'));
  const body = el('span', 'body');
  const top = el('span', 'top');
  top.append(el('span', 'name', item.name));
  const price = formatPrice(item.price);
  if (price) top.append(el('span', 'price', price));
  body.append(top);

  const meta = el('span', 'meta');
  const bits = [item.pack, formatUnitPrice(item.unit_price, item.unit), item.chain].filter(Boolean) as string[];
  if (bits.length) meta.append(el('span', 'details', bits.join(' · ')));
  if (item.discount) meta.append(el('span', 'badge discount', item.discount));
  if (item.member) meta.append(el('span', 'badge member', 'Member'));
  if (meta.childNodes.length) body.append(meta);
  if (item.note) body.append(el('span', 'note', item.note));

  btn.append(body);
  li.append(btn);
  return li;
}

function renderSection(section: Section, state: RenderState, handlers: RenderHandlers): HTMLElement {
  const collapsed = state.collapsed.has(section.id);
  const { done, total } = sectionCount(section, state.checked);
  const wrap = el('section', `section${done === total ? ' complete' : ''}`);
  wrap.dataset.section = section.id;

  const listId = `items-${section.id}`;
  const header = el('button', 'section-header');
  header.type = 'button';
  header.setAttribute('aria-expanded', String(!collapsed));
  header.setAttribute('aria-controls', listId);
  header.addEventListener('click', () => handlers.onToggleSection(section.id));
  header.append(el('span', 'chevron'), el('span', 'section-title', section.title), el('span', 'count', `${done}/${total}`));
  wrap.append(el('h2'));
  wrap.firstElementChild!.append(header);

  const ul = el('ul', 'items');
  ul.id = listId;
  ul.hidden = collapsed;
  for (const item of orderItems(section.items, state.checked)) {
    ul.append(renderItem(item, state.checked.has(item.id), handlers));
  }
  wrap.append(ul);
  return wrap;
}

export function renderList(root: HTMLElement, state: RenderState, handlers: RenderHandlers): void {
  const frag = document.createDocumentFragment();
  if (state.list.sections.length === 0) {
    frag.append(el('p', 'empty', 'The list is empty this week.'));
  }
  for (const section of state.list.sections) frag.append(renderSection(section, state, handlers));
  root.replaceChildren(frag);
}
