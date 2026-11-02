import '@chatdom/ui/kit.css';
import './bag.css';
import { createKingdomAudio } from '@chatdom/audio';
import type { ItemEvent, ItemRecord, KingdomId, PersonId } from '@chatdom/shared';
import { mountBag } from './bag';
import { mountItemCard } from './card';
import { el } from './dom';
import { mountHotbar } from './hotbar';
import { disposeItemPortraits } from './portrait';
import { createStagedItemLink } from './staged';
import { createBagStore } from './store';

type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomBagError?: string };

const JUNIPER = '41277301' as PersonId;
const KINGDOM = '512730019' as KingdomId;
const WHERE = 'Willowmere pier';
const at = (hour: number, minute: number) => Date.UTC(2026, 10, 2, hour, minute);

interface Catch { readonly id: string; readonly defId: string; readonly times: readonly number[]; readonly best: number; readonly lengthMm: number;
  readonly hour: string; readonly mood: string; readonly line: string; readonly storied?: boolean }

const ROD = '0a3f1c52-6e1b-4b7a-9d2e-1f4c8b7a9e01';
const CATCHES: readonly Catch[] = [
  { id: '1b7d2e90-4c3a-4f8e-a1d5-6e2b9c0f7a12', defId: 'fish:copper-perch', best: 1120, lengthMm: 342, hour: 'dusk', mood: 'clear',
    line: 'Caught at dusk in clear weather.', times: [at(17, 8), at(17, 21), at(17, 34), at(17, 52), at(18, 5), at(18, 17), at(18, 31)] },
  { id: '2c4e6a81-9b0d-4e3f-8a7c-5d1e2f3a4b23', defId: 'fish:bell-minnow', best: 64, lengthMm: 141, hour: 'dusk', mood: 'clear',
    line: 'Caught at dusk in clear weather.', times: [at(17, 14), at(17, 18), at(17, 27), at(17, 40), at(17, 46), at(17, 58), at(18, 9), at(18, 22),
      at(18, 40), at(19, 2), at(19, 37), at(19, 58)] },
  { id: '3d5f7b92-0c1e-4f40-9b8d-6e2f3a4b5c34', defId: 'fish:silver-dace', best: 288, lengthMm: 254, hour: 'dusk', mood: 'mist',
    line: 'Caught at dusk in the mist.', times: [at(18, 48), at(19, 6), at(19, 21)] },
  { id: '4e6a8c03-1d2f-4a51-8c9e-7f3a4b5c6d45', defId: 'fish:lantern-eel', best: 1460, lengthMm: 870, hour: 'night', mood: 'mist',
    line: 'Caught at night in the mist.', times: [at(20, 46)], storied: true },
  { id: '5f7b9d14-2e3a-4b62-9dae-8a4b5c6d7e56', defId: 'fish:moonlit-pike', best: 6840, lengthMm: 1120, hour: 'dusk', mood: 'mist',
    line: 'Caught at dusk in the mist.', times: [at(19, 12)], storied: true },
];

/** A day at Willowmere pier, as the realm would have written it. */
export function stagedBag(): { records: ItemRecord[]; history: Record<string, ItemEvent[]> } {
  const by = { personId: JUNIPER, name: 'Juniper' };
  const records: ItemRecord[] = [{
    version: 1, id: ROD, defId: 'tool:rod.willow', branch: 'held', ownerId: JUNIPER, kingdomId: KINGDOM, origin: 'live', place: 'hotbar', slot: 0,
    count: 1, storied: true, number: null, story: { by, kingdomId: KINGDOM, where: WHERE, at: at(16, 52), line: 'Taken from the rod rack.' },
    source: { kind: 'pier', ref: 'pier:lake:willow-rod' }, detail: {}, createdAt: at(16, 52), revision: 0,
  }];
  const history: Record<string, ItemEvent[]> = {
    [ROD]: [{ itemId: ROD, kind: 'granted', at: at(16, 52), to: 'hotbar', count: 1, actor: 'kingdom', source: { kind: 'pier', ref: 'pier:lake:willow-rod' } }],
  };
  for (const fish of CATCHES) {
    const first = fish.times[0]!, last = fish.times.at(-1)!;
    const source = { kind: 'fishing' as const, ref: `${fish.id.slice(0, 8)}-cast-1` };
    records.push({
      version: 1, id: fish.id, defId: fish.defId, branch: 'gathered', ownerId: JUNIPER, kingdomId: KINGDOM, origin: 'live', place: 'bag', slot: null,
      count: fish.times.length, storied: fish.storied === true, number: null,
      story: { by, kingdomId: KINGDOM, where: WHERE, at: first, line: fish.line }, source,
      detail: { weightG: fish.best, lengthMm: fish.lengthMm, hour: fish.hour, mood: fish.mood, water: 'lake',
        firstCaughtAt: first, lastCaughtAt: last, firstCaughtWhere: WHERE, lastCaughtWhere: WHERE },
      createdAt: first, revision: fish.times.length - 1,
    });
    history[fish.id] = fish.times.map((time, index): ItemEvent => ({ itemId: fish.id, kind: index ? 'stacked' : 'granted', at: time, to: 'bag', count: 1,
      actor: 'kingdom', source: { kind: 'fishing', ref: `${fish.id.slice(0, 8)}-cast-${index + 1}` } }));
  }
  return { records, history };
}

/**
 * The bag's staging surface at `/-/pier?view=bag`: the satchel open over a dark warm room, the belt beneath it, and a
 * card opened by `card=<item kind>`. It never joins a kingdom; its records live only in this page.
 */
export function mountBagBench(host: HTMLElement, query: URLSearchParams): () => void {
  const W = window as BenchWindow;
  W.__chatdomReady = false;
  const staged = stagedBag();
  const link = createStagedItemLink(staged.records, { history: staged.history, now: () => at(21, 4) });
  const store = createBagStore(link, { personId: JUNIPER });
  const audio = createKingdomAudio();
  const sound = (surface: 'wood' | 'brass' | 'parchment') => { audio.cue('wood', { ui: surface }); };
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  const room = el('div', 'cdbb');
  Object.assign(room.style, {
    position: 'fixed', inset: '0', overflow: 'hidden', color: 'var(--cd-cream)',
    background: 'radial-gradient(ellipse 60% 48% at 50% 30%, #6b3f2433, transparent 70%), radial-gradient(ellipse 90% 70% at 50% 42%, #3b2418, #20130d 62%, #0f0907)',
  });
  const stage = el('div');
  const hud = el('div');
  Object.assign(hud.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  room.append(stage, hud);
  host.append(room);

  let selected: string | null = ROD;
  const wanted = query.get('card');
  const open = wanted ? [...staged.records].sort((a, b) => Number(b.storied) - Number(a.storied)).find(record => record.defId === wanted)?.id : undefined;
  if (wanted && !open) W.__chatdomBagError = 'No staged thing of that kind.';
  const solo = query.get('solo') === 'card';
  let teardown: (() => void) | null = null;
  const mount = () => {
    teardown?.();
    const compact = matchMedia('(max-width: 700px)').matches;
    Object.assign(stage.style, { position: 'absolute', inset: compact ? '0 0 80px 0' : '0 0 92px 0' });
    let stop: () => void;
    if (solo && open) {
      // A single tag on the table, for looking at the card by itself.
      Object.assign(stage.style, { display: 'grid', placeItems: 'center', padding: '40px 16px' });
      const holder = el('div');
      Object.assign(holder.style, { width: compact ? '100%' : '360px' });
      stage.append(holder);
      const record = store.item(open) ?? staged.records.find(entry => entry.id === open)!;
      const unmount = mountItemCard(holder, record, { viewerPersonId: JUNIPER, history: () => store.history(open), sound });
      stop = () => { unmount(); holder.remove(); };
    } else {
      Object.assign(stage.style, { display: '', placeItems: '', padding: '' });
      stop = mountBag(stage, store, { viewerPersonId: JUNIPER, compact, sound, ...(open ? { openItemId: open } : {}) });
    }
    const bar = mountHotbar(hud, store, { compact, sound, selected: () => selected, onSelect: id => { selected = id; bar.refresh(); } });
    teardown = () => { stop(); bar.dispose(); };
  };
  mount();
  const media = matchMedia('(max-width: 700px)');
  media.addEventListener('change', mount);

  // Ready once every picture has drawn (or shown its empty frame) and the open card has read its story.
  let ended = false, timer: ReturnType<typeof setTimeout> | null = null, waited = 0;
  const check = () => {
    timer = null;
    if (ended) return;
    const pending = room.querySelectorAll('canvas[data-portrait="pending"], canvas:not([data-portrait]), [data-history="loading"]').length;
    const loaded = store.status() !== 'loading' && room.querySelectorAll('canvas').length > 0 && document.fonts.status === 'loaded';
    if (loaded && pending === 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!ended) W.__chatdomReady = true; }));
      return;
    }
    waited += 50;
    if (waited > 60_000) { W.__chatdomBagError = 'The bag pictures took too long to draw.'; return; }
    timer = setTimeout(check, 50);
  };
  timer = setTimeout(check, 50);

  return () => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    media.removeEventListener('change', mount);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    teardown?.();
    store.dispose();
    link.dispose();
    audio.dispose();
    disposeItemPortraits();
    room.remove();
    W.__chatdomReady = false;
  };
}
