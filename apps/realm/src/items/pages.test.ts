import { expect, it } from 'vitest';
import { ItemHistoryCursorSchema, ItemListCursorSchema, ItemRequestSchema, KingdomIdSchema, PersonIdSchema, type ItemDefinition, type ItemRecord } from '@chatdom/shared';
import { createItemCatalogue, createRealmItems, type GrantInput } from './index';
import { createMemoryItemStore } from './memory';

const kingdomId = KingdomIdSchema.parse('200'), elsewhere = KingdomIdSchema.parse('201');
const ownerId = PersonIdSchema.parse('100'), stranger = PersonIdSchema.parse('101');
const rod: ItemDefinition = { id: 'tool:rod', branch: 'held', title: 'Rod', lore: 'A willow rod.', stack: null, keepsake: false, model: 'tool:rod', places: ['bag', 'away'] };
const fish: ItemDefinition = { id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 10, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] };
function setup() {
  let time = 1000;
  const items = createRealmItems({ store: createMemoryItemStore(), catalogue: createItemCatalogue([rod, fish]), clock: () => time++ });
  const grant = (key: string, changes: Partial<GrantInput> = {}) => items.grant({ key, ownerId, kingdomId, origin: 'live', defId: rod.id,
    story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, where: 'pier', at: 900, line: 'Taken here.' }, source: { kind: 'pier', ref: key }, ...changes });
  return { items, grant };
}

it('pages all records in key order without duplicates, excluding other people, kingdoms, origins and spent stacks', async () => {
  const { items, grant } = setup();
  const created: ItemRecord[] = [];
  for (let i = 0; i < 75; i++) created.push(await grant(`rod-${i}`));
  await grant('other-owner', { ownerId: stranger });
  await grant('other-kingdom', { kingdomId: elsewhere, story: { ...created[0]!.story, kingdomId: elsewhere } });
  await grant('other-origin', { origin: 'simulated' });
  const spent = await grant('spent', { defId: fish.id });
  expect(await items.release(ownerId, spent.id, 1, 0)).toMatchObject({ ok: true });
  await items.forgetName(ownerId);
  const records: ItemRecord[] = [];
  let after: string | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await items.listPage(ownerId, kingdomId, 'live', after);
    expect(page.items.length).toBeLessThanOrEqual(32);
    records.push(...page.items);
    if (page.next === null) break;
    expect(page.next).toBe(page.items.at(-1)?.id);
    after = page.next;
  }
  expect(records.map(item => item.id)).toEqual(created.map(item => item.id).sort());
  expect(new Set(records.map(item => item.id)).size).toBe(75);
  expect(records.every(item => item.ownerId === ownerId && item.kingdomId === kingdomId && item.origin === 'live' && item.story.by?.name === 'a citizen')).toBe(true);
  expect(await items.get(spent.id)).toMatchObject({ place: 'spent' });
});

it('pages over 100 actual movement events once each in append order', async () => {
  const { items, grant } = setup(), item = await grant('history');
  for (let revision = 0; revision < 105; revision++) {
    const result = await items.move(ownerId, item.id, { place: revision % 2 === 0 ? 'away' : 'bag', slot: null }, revision);
    expect(result).toMatchObject({ ok: true, item: { revision: revision + 1 } });
  }
  const expected = await items.history(item.id), events = [];
  let after: string | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await items.historyPage(item.id, after);
    expect(page.events.length).toBeLessThanOrEqual(32);
    events.push(...page.events);
    if (page.next === null) break;
    after = page.next;
  }
  expect(expected).toHaveLength(106);
  expect(events).toEqual(expected);
});

it('bounds the full JSON reply even when each record has nearly 24 KiB of authored detail', async () => {
  const { items, grant } = setup();
  const detail = Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`field${i}`, 'x'.repeat(490)]));
  expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThanOrEqual(24 * 1024);
  expect(Buffer.byteLength(JSON.stringify(detail))).toBeGreaterThan(23 * 1024);
  for (let i = 0; i < 4; i++) await grant(`large-${i}`, { detail });
  const seen: string[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const page = await items.listPage(ownerId, kingdomId, 'live', after);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(32);
    expect(Buffer.byteLength(JSON.stringify({ type: 'items.list', id: 'x'.repeat(64), ...page }))).toBeLessThanOrEqual(48 * 1024);
    seen.push(...page.items.map(item => item.id));
    if (page.next === null) break;
    after = page.next;
  }
  expect(new Set(seen).size).toBe(4);
});

it('rejects malformed or huge cursors safely and limits authored detail', async () => {
  for (const value of ['', '-1', '00', '9223372036854775808', '9'.repeat(10000), '1e5', '💧', {}, null]) {
    expect(() => ItemHistoryCursorSchema.safeParse(value)).not.toThrow();
    expect(ItemHistoryCursorSchema.safeParse(value).success).toBe(false);
    expect(() => ItemRequestSchema.safeParse({ type: 'items.history', id: 'x', itemId: 'item', after: value })).not.toThrow();
    expect(ItemRequestSchema.safeParse({ type: 'items.history', id: 'x', itemId: 'item', after: value }).success).toBe(false);
  }
  expect(ItemHistoryCursorSchema.safeParse('9223372036854775807').success).toBe(true);
  for (const value of ['', 'x'.repeat(65), 'x/y', {}, null]) {
    expect(() => ItemListCursorSchema.safeParse(value)).not.toThrow();
    expect(ItemListCursorSchema.safeParse(value).success).toBe(false);
  }
  const { grant } = setup();
  await expect(grant('too-many', { detail: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`key${i}`, i])) })).rejects.toThrow();
  await expect(grant('too-large', { detail: Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`key${i}`, 'x'.repeat(500)])) })).rejects.toThrow();
});
