import '@chatdom/ui/kit.css';
import '../providers';
import { createKingdomAudio } from '@chatdom/audio';
import { SHELF_SLOTS } from '@chatdom/shared';
import { el, type BagSurface } from '../dom';
import { disposeItemPortraits } from '../portrait';
import { mountShelf } from './index';
import { createStagedShelfSource, stagedNow, stagedPieces, stagedShelf, STAGED_NAME } from './staged';
import type { VisitShelfSource } from './types';

type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomShelfError?: string };

const countOf = (value: string | null): number => {
  if (value === null || !/^\d{1,3}$/.test(value)) return 12;
  return Math.min(SHELF_SLOTS, Number(value));
};

/**
 * The shelf's staging surface at `/-/pier?view=shelf`, for review without a kingdom:
 *   count=N    keepsakes standing on the shelf (default 12; 0 shows the empty shelf, at most 64)
 *   visit=1    the same shelf as a visitor at Juniper's door sees it ("Juniper's shelf", read-only)
 *   card=1     opens the first keepsake's story tag once the shelf is drawn
 *   drawer=1   two more keepsakes still waiting in the bag (own shelf only)
 *   hour=H     the scene hour the room is lit for (default warm evening)
 * Sets `window.__chatdomReady` once the room, every keepsake and any open tag have drawn.
 */
export function mountShelfBench(host: HTMLElement, query: URLSearchParams): () => void {
  const W = window as BenchWindow;
  W.__chatdomReady = false;
  const visiting = query.get('visit') === '1';
  const records = stagedShelf(countOf(query.get('count')), query.get('drawer') === '1' && !visiting ? 2 : 0);
  const own = createStagedShelfSource(records, stagedNow);
  const visit: VisitShelfSource = { mode: 'visit', name: STAGED_NAME, pieces: stagedPieces(records) };
  const first = records.filter(record => record.place === 'shelf').sort((a, b) => a.slot! - b.slot!)[0]?.id;
  const opening = query.get('card') === '1' ? first : undefined;
  const hourValue = Number(query.get('hour'));
  const hour = query.has('hour') && Number.isFinite(hourValue) ? hourValue : undefined;

  const audio = createKingdomAudio();
  const sound = (surface: BagSurface) => { audio.cue('wood', { ui: surface }); };
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  const room = el('div', 'cdshb');
  Object.assign(room.style, { position: 'fixed', inset: '0', overflow: 'hidden', background: '#140b07' });
  host.append(room);

  let ended = false, closed = false, ready = false, timer: ReturnType<typeof setTimeout> | null = null;
  // Ready once the shelf says so, the open tag has painted its picture and read its story, and the fonts are in.
  const settle = (waited = 0) => {
    timer = null;
    if (ended || !ready) return;
    const pending = room.querySelectorAll('.cdc-frame:not([data-portrait]), .cdsh-drawer-well:not([data-portrait]), [data-history="loading"]').length;
    if (pending === 0 && document.fonts.status === 'loaded') {
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!ended) W.__chatdomReady = true; }));
      return;
    }
    if (waited > 60_000) { W.__chatdomShelfError = 'The shelf took too long to draw.'; return; }
    timer = setTimeout(() => settle(waited + 50), 50);
  };

  let teardown: (() => void) | null = null;
  const media = matchMedia('(max-width: 700px)');
  const mount = () => {
    teardown?.();
    W.__chatdomReady = false;
    ready = false;
    teardown = mountShelf(room, visiting ? visit : own, {
      compact: media.matches,
      sound,
      kingdomName: 'Willowmere',
      ...(hour !== undefined ? { hour } : {}),
      ...(opening && !closed ? { openItemId: opening } : {}),
      onClose: () => {
        // A bench has nowhere to go back to: closing leaves the room empty until the page is reloaded.
        closed = true;
        teardown?.();
        teardown = null;
      },
      onReady: () => { ready = true; if (timer) clearTimeout(timer); settle(); },
    });
  };
  mount();
  media.addEventListener('change', mount);

  return () => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    media.removeEventListener('change', mount);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    teardown?.();
    own.dispose();
    audio.dispose();
    disposeItemPortraits();
    room.remove();
    W.__chatdomReady = false;
  };
}
