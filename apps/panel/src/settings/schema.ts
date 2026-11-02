import type { PanelSettings } from '../../../../packages/shared/src/panel';
import { DEFAULT_GIFT_IDS, GIFT_CATALOGUE } from '../gifts/catalogue';

export const SETTINGS_VERSION = '1';
export const DEFAULT_SETTINGS: PanelSettings = {
  version: 1, tabs: { kingdom: true, you: true, gifts: true }, hidden: false,
  gifts: DEFAULT_GIFT_IDS.map(giftId => ({ giftId, band: 'a' })),
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

/** Strict, bounded public configuration. Unknown versions never silently become active defaults. */
export function parsePanelSettings(value: unknown): PanelSettings | null {
  if (!record(value) || !keys(value, ['version', 'tabs', 'hidden', 'gifts']) || value.version !== 1 || typeof value.hidden !== 'boolean'
    || !record(value.tabs) || !keys(value.tabs, ['kingdom', 'you', 'gifts']) || value.tabs.kingdom !== true
    || typeof value.tabs.you !== 'boolean' || typeof value.tabs.gifts !== 'boolean' || !Array.isArray(value.gifts) || value.gifts.length > 8) return null;
  const seen = new Set<string>();
  const gifts: { giftId: string; band: 'a' | 'b' | 'c' }[] = [];
  for (const selection of value.gifts) {
    if (!record(selection) || !keys(selection, ['giftId', 'band']) || typeof selection.giftId !== 'string'
      || !GIFT_CATALOGUE.some(gift => gift.id === selection.giftId) || seen.has(selection.giftId)
      || (selection.band !== 'a' && selection.band !== 'b' && selection.band !== 'c')) return null;
    seen.add(selection.giftId);
    gifts.push({ giftId: selection.giftId, band: selection.band });
  }
  return { version: 1, hidden: value.hidden, tabs: { kingdom: true, you: value.tabs.you, gifts: value.tabs.gifts }, gifts };
}
