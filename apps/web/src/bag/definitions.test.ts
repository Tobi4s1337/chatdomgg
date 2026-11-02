import { afterAll, describe, expect, it } from 'vitest';
import type { ItemDefinition } from '@chatdom/shared';
import { FISH_ITEM_DEFINITIONS } from '../../../../packages/content/src/fish';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { itemDefinition, registerItemDefinitions } from './definitions';
import { hotbarSlots } from './hotbar';
import { compareItems, eventWords, kindLabel, titleOf } from './kinds';
import { record } from './records.fixture';
import { formatKinds, formatMoment, formatTally, formatWhere } from './words';

const lamp: ItemDefinition = { id: 'tool:lamp.brass', branch: 'held', title: 'Brass Lamp', lore: 'It remembers every doorway.', stack: null,
  keepsake: false, model: 'tool:lamp.brass', places: ['hand', 'hotbar', 'bag'] };

describe('item definitions on the client', () => {
  const release = registerItemDefinitions([...FISH_ITEM_DEFINITIONS, WILLOW_ROD_DEFINITION]);
  afterAll(release);

  it('registers a batch, and a conflicting batch registers nothing', () => {
    expect(itemDefinition('fish:copper-perch')?.title).toBe('Copper Perch');
    expect(() => registerItemDefinitions([lamp, { ...WILLOW_ROD_DEFINITION, title: 'Another Rod' }])).toThrow();
    expect(itemDefinition('tool:lamp.brass')).toBeUndefined();
    expect(() => registerItemDefinitions([lamp, { ...lamp, lore: 'Different words.' }])).toThrow();
    expect(itemDefinition('tool:lamp.brass')).toBeUndefined();
    expect(() => registerItemDefinitions([{ ...lamp, id: 'Not An Id' }])).toThrow();
  });

  it('shares identical registrations until both are released', () => {
    const first = registerItemDefinitions([lamp]), second = registerItemDefinitions([{ ...lamp, places: [...lamp.places] }]);
    first();
    expect(itemDefinition('tool:lamp.brass')?.title).toBe('Brass Lamp');
    second(); second();
    expect(itemDefinition('tool:lamp.brass')).toBeUndefined();
  });

  it('names things in words, never ids, and sorts tools first then the rarest catch', () => {
    expect(titleOf('fish:not-yet-written')).toBe('An uncatalogued thing');
    const items = [
      record('a', { defId: 'fish:silver-dace', count: 3 }), record('b', { defId: 'fish:moonlit-pike', storied: true }),
      record('c', { defId: 'tool:rod.willow', branch: 'held', place: 'hotbar', slot: 0, storied: true }),
      record('d', { defId: 'fish:lantern-eel', storied: true }), record('e', { defId: 'fish:bell-minnow', count: 12 }),
    ].sort(compareItems);
    expect(items.map(item => titleOf(item.defId))).toEqual(['Willow Rod', 'Moonlit Pike', 'Lantern Eel', 'Bell Minnow', 'Silver Dace']);
    expect(kindLabel(items[1]!)).toBe('Rare catch');
    expect(kindLabel(items[0]!)).toBe('Tool');
  });

  it('keys the belt by slot and gives a tool in hand the first free key', () => {
    const slots = hotbarSlots([
      record('rod', { defId: 'tool:rod.willow', branch: 'held', place: 'hand', slot: null }),
      record('lamp', { defId: 'tool:lamp.brass', branch: 'held', place: 'hotbar', slot: 0 }),
      record('net', { defId: 'tool:net.reed', branch: 'held', place: 'hotbar', slot: 4 }),
      record('fish', { place: 'bag' }),
      record('far', { defId: 'tool:far', branch: 'held', place: 'hotbar', slot: 12 }),
    ]);
    expect(slots.map(slot => [slot.item.id, slot.key])).toEqual([['lamp', 1], ['rod', 2], ['net', 5]]);
  });

  it('writes facts and history the way a person says them', () => {
    expect(formatTally(12, true)).toBe('12 caught');
    expect(formatTally(1, true)).toBe('');
    expect(formatKinds([{ count: 1, one: 'tool', many: 'tools' }, { count: 22, one: 'fish', many: 'fish' }, { count: 0, one: 'keepsake', many: 'keepsakes' }])).toBe('1 tool · 22 fish');
    expect(formatWhere({ place: 'hotbar', slot: 0 })).toBe('On your belt, slot 1');
    expect(formatWhere({ place: 'bag', slot: null })).toBe('In your bag');
    expect(formatMoment(Date.UTC(2026, 10, 2, 17, 8))).toBe('2 November, 17:08');
    expect(formatMoment(Number.NaN)).toBe('');
    expect(eventWords({ itemId: 'a', kind: 'granted', at: 0, actor: 'kingdom', source: { kind: 'pier', ref: 'rack' } }, 'tool:rod.willow')).toBe('Taken from the rack');
    expect(eventWords({ itemId: 'a', kind: 'stacked', at: 0, actor: 'kingdom', count: 3, source: { kind: 'fishing', ref: 'c' } }, 'fish:bell-minnow')).toBe('3 more caught');
    expect(eventWords({ itemId: 'a', kind: 'moved', at: 0, actor: 'owner', from: 'bag', to: 'hotbar' }, 'tool:rod.willow')).toBe('Hung on your belt');
  });
});
