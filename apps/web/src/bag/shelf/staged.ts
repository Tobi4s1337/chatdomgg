import { SHELF_SLOTS, type ItemEvent, type ItemRecord, type KingdomId, type PersonId, type ShelfPiece, type ShelfSettings } from '@chatdom/shared';
import { FISH_SPECIES } from '../../../../../packages/content/src/fish/species';
import { FISH_MOUNT_DEFINITIONS, fishOfMount } from '../../../../../packages/content/src/keepsakes';
import type { OwnShelfSource, ShelfResult } from './types';

/*
 * A staged shelf for review and tests: Juniper's mounted catches from Willowmere pier, kept in the page. It never
 * reaches a kingdom.
 */
const JUNIPER = '41277301' as PersonId;
const KINGDOM = '512730019' as KingdomId;
const WHERE = 'Willowmere pier';
export const STAGED_NAME = 'Juniper';
const at = (day: number, hour: number, minute: number) => Date.UTC(2026, 9, day, hour, minute);
const HOURS = ['dusk', 'night', 'dawn', 'day'] as const;
const MOODS = ['mist', 'clear', 'rain', 'clear', 'mist'] as const;
const WORDS: Record<string, string> = { dusk: 'at dusk', night: 'at night', dawn: 'at dawn', day: 'in the afternoon' };
/** The hour (UTC, as the card reads it) each band is staged at, so "at dusk" never sits beside a morning time. */
const CLOCK: Record<string, number> = { dusk: 18, night: 22, dawn: 6, day: 14 };
const WEATHER: Record<string, string> = { mist: 'in the mist', clear: 'in clear weather', rain: 'in the rain' };
/** How long the staged kingdom takes to answer, so the pending state is visible in review. */
const ROUND_TRIP_MS = 140;

/** A stable id per staged keepsake, shaped like the realm's. */
const keepsakeId = (index: number) => `7c${index.toString(16).padStart(6, '0')}-5e2a-4d1b-9f3c-${(0x2b4d6f8a1c3e + index * 7919).toString(16).padStart(12, '0')}`;

/** One mounted catch, as the realm would have written it when it was kept. */
function stagedKeepsake(index: number, place: 'shelf' | 'bag', slot: number | null): ItemRecord {
  const def = FISH_MOUNT_DEFINITIONS[index % FISH_MOUNT_DEFINITIONS.length]!;
  const species = FISH_SPECIES.find(fish => fish.id === fishOfMount(def.id));
  const hour = HOURS[index % HOURS.length]!, mood = MOODS[index % MOODS.length]!;
  const caught = at(1 + (index * 3) % 30, CLOCK[hour]! + index % 2, (index * 17) % 60);
  // Toward the top of the species' range: these are the catches worth keeping.
  const lengthMm = species ? Math.round(species.lengthMm[0] + (species.lengthMm[1] - species.lengthMm[0]) * (.72 + (index % 4) * .07)) : 300;
  const weightG = species ? Math.round(species.weightG[0] + (species.weightG[1] - species.weightG[0]) * (.7 + (index % 4) * .075)) : 900;
  return {
    version: 1, id: keepsakeId(index), defId: def.id, branch: 'kept', ownerId: JUNIPER, kingdomId: KINGDOM, origin: 'live', place, slot,
    count: 1, storied: true, number: 1 + (index * 7) % 9,
    story: { by: { personId: JUNIPER, name: 'Juniper' }, kingdomId: KINGDOM, where: WHERE, at: caught,
      line: `Caught ${WORDS[hour]} ${WEATHER[mood]}.` },
    source: { kind: 'fishing', ref: `${keepsakeId(index).slice(0, 8)}-cast-1` },
    detail: { weightG, lengthMm, hour, mood, water: 'lake' },
    createdAt: caught, revision: 0,
  };
}

/** `count` keepsakes standing in pride order, and `waiting` more still in the bag. */
export function stagedShelf(count: number, waiting: number): ItemRecord[] {
  const records: ItemRecord[] = [];
  for (let i = 0; i < count; i++) records.push(stagedKeepsake(i, 'shelf', i));
  for (let i = 0; i < waiting; i++) records.push(stagedKeepsake(count + i, 'bag', null));
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

/** What a visitor at Juniper's door is shown of the same shelf: the story, never a person id. */
export function stagedPieces(records: readonly ItemRecord[]): ShelfPiece[] {
  return records.filter(record => record.place === 'shelf' && record.slot !== null).map(record => ({
    id: record.id, defId: record.defId, slot: record.slot!, number: record.number,
    story: { name: record.story.by?.name ?? null, where: record.story.where, at: record.story.at, line: record.story.line },
    detail: record.detail,
  }));
}

/**
 * Juniper's own shelf, kept in this page: arranging into a taken place swaps the two, as the realm does; taking one
 * down puts it back in the bag; the door's toggle remembers itself. Nothing here reaches a kingdom.
 */
export function createStagedShelfSource(records: ItemRecord[], now: () => number = Date.now): OwnShelfSource & { dispose(): void } {
  let items = records.slice();
  let settings: ShelfSettings | null = null;
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const history = new Map<string, ItemEvent[]>(records.map(record => [record.id, [
    { itemId: record.id, kind: 'granted', at: record.createdAt, to: 'bag', count: 1, actor: 'kingdom', source: record.source },
    ...(record.place === 'shelf' ? [{ itemId: record.id, kind: 'moved' as const, at: record.createdAt + 90_000, from: 'bag' as const, to: 'shelf' as const, actor: 'owner' as const }] : []),
  ]]));
  const later = <T>(work: () => T) => new Promise<T>(resolve => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(work()); }, ROUND_TRIP_MS);
    timers.add(timer);
  });
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const record = (id: string, kind: ItemEvent['kind'], from: ItemRecord['place'], to: ItemRecord['place']) =>
    history.get(id)?.push({ itemId: id, kind, at: now(), from, to, actor: 'owner' });
  const set = (id: string, place: ItemRecord['place'], slot: number | null) => {
    items = items.map(item => item.id === id ? { ...item, place, slot, revision: item.revision + 1 } : item);
  };
  later(() => { settings = { shown: false, revision: 0 }; notify(); });

  return {
    mode: 'own',
    personId: JUNIPER,
    items: () => items,
    settings: () => settings,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    arrange: (itemId, slot) => later((): ShelfResult => {
      const item = items.find(entry => entry.id === itemId);
      if (!item) return { ok: false, message: 'That keepsake is no longer in your bag.' };
      if (!Number.isInteger(slot) || slot < 0 || slot >= SHELF_SLOTS) return { ok: false, message: 'There is no place there on your shelf.' };
      if (item.place === 'shelf' && item.slot === slot) return { ok: true };
      const taken = items.find(entry => entry.place === 'shelf' && entry.slot === slot && entry.id !== itemId);
      if (taken) {
        // The two trade places; a keepsake moved off the shelf by the swap goes back to the bag.
        const back = item.place === 'shelf' ? item.slot : null;
        set(taken.id, back === null ? 'bag' : 'shelf', back);
        record(taken.id, 'moved', 'shelf', back === null ? 'bag' : 'shelf');
      }
      set(itemId, 'shelf', slot);
      record(itemId, 'moved', item.place, 'shelf');
      notify();
      return { ok: true };
    }),
    takeDown: itemId => later((): ShelfResult => {
      const item = items.find(entry => entry.id === itemId);
      if (!item || item.place !== 'shelf') return { ok: false, message: 'That keepsake is not on your shelf.' };
      set(itemId, 'bag', null);
      record(itemId, 'moved', 'shelf', 'bag');
      notify();
      return { ok: true };
    }),
    show: shown => later((): ShelfResult => {
      settings = { shown, revision: (settings?.revision ?? 0) + 1 };
      notify();
      return { ok: true };
    }),
    history: itemId => later(() => (history.get(itemId) ?? []).slice()),
    dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); listeners.clear(); },
  };
}


/** The staged evening's clock: half past nine, the last day of October. */
export const stagedNow = (): number => at(30, 21, 4);
