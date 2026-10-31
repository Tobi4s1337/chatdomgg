// The shelf's fixed menu (`Twitch.md` §17). A streamer chooses which of these their panel
// offers; nobody writes a new one. Every product is a moment or a thing that lasts one day,
// seen by the whole kingdom. None brings light, rank, a place, coals, tenure or anything
// permanent, and none takes free text, music by request or a chance at an outcome.
import type { ShelfProduct } from './model';

export interface MenuItem {
  readonly sku: string;
  readonly title: string;
  readonly bits: number;
  readonly what: string;
  /** What stays for a day, or null when nothing stays after the moment. */
  readonly stays: string | null;
}

export const SHELF_MENU: readonly MenuItem[] = [
  { sku: 'fireworks', title: 'Fireworks for a friend', bits: 100, what: 'Fireworks over a citizen you pick, in both your colours, with both names.', stays: null },
  { sku: 'dress-home', title: 'Dress my home', bits: 300, what: 'Bunting and festival banners in your colours, shown as the stream passes by.', stays: 'The bunting stays up' },
  { sku: 'bard-song', title: 'A song from the bard', bits: 300, what: 'Lark sings four lines about you, from what the kingdom knows of you.', stays: 'The verse hangs on your door' },
  { sku: 'wear-look', title: 'Wear a look for a day', bits: 500, what: 'You step onto the pageant ring and put on one piece from this season’s rack.', stays: 'You wear it' },
  { sku: 'parade', title: 'Lead a parade', bits: 1000, what: 'You lead a parade round the market square, and the Hearthbeast follows.', stays: null },
  { sku: 'feast', title: 'The royal feast', bits: 2500, what: 'Long tables fill the square and every citizen raises a cup in your name.', stays: 'The tables stand' },
];

/** What a new panel offers until its streamer chooses: four moments, one at each step. */
export const DEFAULT_SHELF: readonly string[] = ['bard-song', 'dress-home', 'parade', 'feast'];

/** The chosen items as shelf products, in the menu's order. `until` is when a day-long thing ends. */
export function shelfProducts(chosen: readonly string[], until: string): ShelfProduct[] {
  return SHELF_MENU.filter(item => chosen.includes(item.sku)).map(item => ({
    sku: item.sku, title: item.title, bits: item.bits, what: item.what,
    stays: item.stays ? { kind: 'day', until, what: item.stays } : { kind: 'moment' },
  }));
}
