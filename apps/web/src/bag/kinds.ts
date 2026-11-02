import type { ItemEvent, ItemPlace, ItemRecord } from '@chatdom/shared';
import { FISH_SPECIES } from '../../../../packages/content/src/fish/species';
import { itemDefinition } from './definitions';

export type BagGroup = 'tools' | 'catch' | 'keepsakes' | 'other';
export type Rarity = 'common' | 'uncommon' | 'rare';

const RARITY = new Map<string, Rarity>(FISH_SPECIES.map(fish => [fish.id, fish.rarity]));
const RARITY_RANK: Record<Rarity, number> = { rare: 0, uncommon: 1, common: 2 };
const GROUP_RANK: Record<BagGroup, number> = { tools: 0, catch: 1, keepsakes: 2, other: 3 };
const PLACE_RANK: Record<ItemPlace, number> = { hand: 0, hotbar: 1, worn: 2, bag: 3, shelf: 4, lot: 5, away: 6, spent: 7 };

/** Shown only when the client has not learned a kind of thing yet. Never a raw id. */
const UNKNOWN = { title: 'An uncatalogued thing', lore: 'The kingdom has not written this one down yet.' } as const;

export const isFish = (defId: string) => defId.startsWith('fish:');
export const rarityOf = (defId: string): Rarity | null => RARITY.get(defId) ?? null;
export const titleOf = (defId: string) => itemDefinition(defId)?.title ?? UNKNOWN.title;
export const loreOf = (defId: string) => itemDefinition(defId)?.lore ?? UNKNOWN.lore;

export function groupOf(item: Pick<ItemRecord, 'branch' | 'number'>): BagGroup {
  if (item.branch === 'held' || item.branch === 'worn') return 'tools';
  if (item.number !== null || item.branch === 'kept' || item.branch === 'placed') return 'keepsakes';
  if (item.branch === 'gathered') return 'catch';
  return 'other';
}

export const GROUP_TITLES: Record<BagGroup, string> = { tools: 'Tools', catch: 'Your catch', keepsakes: 'Keepsakes', other: 'Odds and ends' };

/** "Rare catch", "Tool", "Keepsake". */
export function kindLabel(item: Pick<ItemRecord, 'defId' | 'branch' | 'number'>): string {
  const group = groupOf(item);
  if (group === 'tools') return item.branch === 'worn' ? 'Worn' : 'Tool';
  if (group === 'keepsakes') return 'Keepsake';
  if (group === 'catch') {
    const rarity = rarityOf(item.defId);
    if (isFish(item.defId)) return rarity ? `${rarity[0]!.toUpperCase()}${rarity.slice(1)} catch` : 'Catch';
    return 'Gathered';
  }
  return 'Odds and ends';
}

/** Tools first (in hand, then belt order), then the catch rarest first and by name, then keepsakes. */
export function compareItems(a: ItemRecord, b: ItemRecord): number {
  const ga = groupOf(a), gb = groupOf(b);
  if (ga !== gb) return GROUP_RANK[ga] - GROUP_RANK[gb];
  const away = Number(a.place === 'away') - Number(b.place === 'away');
  if (away) return away;
  if (ga === 'tools') {
    const place = PLACE_RANK[a.place] - PLACE_RANK[b.place];
    if (place) return place;
    const slot = (a.slot ?? 99) - (b.slot ?? 99);
    if (slot) return slot;
  }
  if (ga === 'catch') {
    const ra = RARITY_RANK[rarityOf(a.defId) ?? 'common'], rb = RARITY_RANK[rarityOf(b.defId) ?? 'common'];
    if (ra !== rb) return ra - rb;
  }
  const title = titleOf(a.defId).localeCompare(titleOf(b.defId), 'en');
  if (title) return title;
  if (a.storied !== b.storied) return a.storied ? -1 : 1;
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const MOVED_TO: Record<ItemPlace, string> = {
  hand: 'Taken in hand', hotbar: 'Hung on your belt', bag: 'Put in your bag', shelf: 'Set on your shelf', lot: 'Taken home',
  worn: 'Worn', away: 'Put away', spent: 'Used up',
};

/** One line of a thing's story: "Caught", "3 more caught", "Hung on your belt". */
export function eventWords(event: ItemEvent, defId: string): string {
  const caught = event.source?.kind === 'fishing' || (event.source === undefined && isFish(defId));
  switch (event.kind) {
    case 'granted':
      if (event.source?.kind === 'pier') return 'Taken from the rack';
      if (event.source?.kind === 'gift') return 'Given to you';
      if (caught) return 'Caught';
      return 'Came to you';
    case 'stacked': {
      const n = event.count ?? 1;
      if (caught) return n > 1 ? `${n} more caught` : 'Another caught';
      return n > 1 ? `${n} more added` : 'One more added';
    }
    case 'moved': return event.to ? MOVED_TO[event.to] : 'Moved';
    case 'put-away': return 'Put away';
    case 'released': return event.count && event.count > 1 ? `${event.count} let go` : 'Let go';
    case 'spent': return 'Used up';
    case 'given': return 'Given';
    default: return 'Moved';
  }
}
