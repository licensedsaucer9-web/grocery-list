export const LIST_VERSION = 1;

export interface Item {
  id: string;
  name: string;
  pack: string | null;
  price: number | null;
  unit_price: number | null;
  unit: string | null;
  chain: string | null;
  discount: string | null;
  member: boolean;
  note: string | null;
}

export interface Section {
  id: string;
  title: string;
  items: Item[];
}

export interface GroceryList {
  version: number;
  week_start: string | null;
  synced_at: string;
  list_hash: string;
  sections: Section[];
}
