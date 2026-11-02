// Compatibility menu for the development bench. The live shelf uses the fixed catalogue
// and the amounts supplied by Twitch's product list.
import type { ShelfProduct } from './model';
import { DEFAULT_GIFT_IDS, GIFT_CATALOGUE } from './gifts/catalogue';

export interface MenuItem {
  readonly sku: string;
  readonly title: string;
  readonly bits: number;
  readonly what: string;
  readonly stays: string | null;
}

export const SHELF_MENU: readonly MenuItem[] = GIFT_CATALOGUE.map(gift => ({
  sku: gift.id, title: gift.title, bits: gift.bands[0].suggestedBits, what: gift.what,
  stays: gift.durationMs >= 24 * 60 * 60 * 1000 ? gift.what : null,
}));
export const DEFAULT_SHELF: readonly string[] = DEFAULT_GIFT_IDS;
export function shelfProducts(chosen: readonly string[], until: string): ShelfProduct[] {
  return SHELF_MENU.filter(item => chosen.includes(item.sku)).map(item => ({
    sku: item.sku, title: item.title, bits: item.bits, what: item.what,
    stays: item.stays ? { kind: 'day', until, what: item.stays } : { kind: 'moment' },
  }));
}
