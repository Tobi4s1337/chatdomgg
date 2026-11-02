import { render } from 'solid-js/web';
import { ForgeChatStatusReplySchema, ForgeQueueViewSchema, KingdomIdSchema, type ForgeChatWish, type ForgeQueueView } from '@chatdom/shared';
import { openForge, type ForgeQueueRead } from '../forge/play';
import { AnvilVisit } from '../interactions/places/AnvilVisit';
import type { AnvilState } from '../interactions/places/anvil-state';
import '../interactions/places/places.css';

/*
 * Staged review of the anvil's line. Every reply here is a schema-checked fixture served without a network:
 * `?view=broadcaster` (the streamer's panel with names), `maker` (a maker's wish out, theirs next), `anvil` (the
 * visit card beside the anvil while a long ritual runs), `resting` (the panel with an empty line).
 */
declare global { interface Window { __chatdomReady?: boolean; __chatdomQueueError?: string } }

const VIEWS = ['broadcaster', 'maker', 'anvil', 'resting'] as const;
type View = typeof VIEWS[number];
const requested = new URLSearchParams(location.search).get('view');
const view: View = VIEWS.find(value => value === requested) ?? 'broadcaster';
const kingdomId = KingdomIdSchema.parse('123');
const requestId = '00000000-0000-4000-8000-000000000001';
window.__chatdomReady = false;

function staged(now: number): ForgeQueueView {
  const base = { version: 1, kingdomId, at: now } as const;
  switch (view) {
    case 'broadcaster': return ForgeQueueViewSchema.parse({ ...base, total: 5, waiting: 4, forgingSince: now - 9_000, makers: [
      { position: 0, name: 'Wren of Willowmere', state: 'forging' }, { position: 1, name: 'Bramblecat', state: 'waiting' },
      { position: 2, name: 'Juniper', state: 'waiting' }, { position: 3, name: 'Old Tobin the Thatcher', state: 'waiting' },
      { position: 4, name: 'Moss', state: 'waiting' },
    ] });
    case 'maker': return ForgeQueueViewSchema.parse({ ...base, total: 3, waiting: 2, forgingSince: now - 6_000, yours: { position: 1, state: 'waiting' } });
    case 'anvil': return ForgeQueueViewSchema.parse({ ...base, total: 3, waiting: 2, forgingSince: now - 41_000 });
    case 'resting': return ForgeQueueViewSchema.parse({ ...base, total: 0, waiting: 0, forgingSince: null });
  }
}
const readQueue: ForgeQueueRead = async () => staged(Date.now());
const wish: ForgeChatWish | null = view === 'maker'
  ? { requestId, kingdomId, updatedAt: Date.now(), status: 'working', messageId: 'fixture-message', receiptId: 'forge:fixture' } : null;
const transport: NonNullable<Parameters<typeof openForge>[2]> = {
  async session() { return { resumeScope: 'fixture-citizen' }; },
  async status(id) {
    return ForgeChatStatusReplySchema.parse({ version: 1, status: 'ok', kingdomId: id, grant: { status: 'ready' }, availability: { status: 'ready' }, wish });
  },
  async authorize() { throw new Error('This review page does not connect a Twitch account.'); },
  async wish() { throw new Error('This review page does not send wishes.'); },
};

const readyAfterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__chatdomReady = true; }));
try {
  if (view === 'anvil') {
    const root = document.querySelector<HTMLElement>('#anvil')!;
    root.className = 'ix-anvil-layer';
    const state: AnvilState = { heard: 'listening', working: 'assembling', landed: null, standing: 3, latest: { maker: 'Juniper', simulated: false } };
    render(() => <AnvilVisit state={() => state} home={() => 'owned'} coarse={innerWidth < 600} onLeave={() => {}} kingdomId={kingdomId} readQueue={readQueue} />, root);
  } else {
    const root = document.querySelector<HTMLElement>('#panel')!;
    if (sessionStorage.length) sessionStorage.clear();
    openForge({ root, kingdomId, releasePointer() {}, restorePointer() {}, onClosed() {} }, 'hud', transport, { readQueue });
  }
  const observer = new MutationObserver(() => {
    const said = document.querySelector('.forge-queue-line span, .forge-queue-anvil')?.textContent;
    if (said && !document.body.textContent?.includes('Checking the Forge…')) { observer.disconnect(); readyAfterPaint(); }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
} catch (error) {
  window.__chatdomQueueError = error instanceof Error ? error.message : String(error);
  throw error;
}
