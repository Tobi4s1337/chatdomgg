import {
  ForgeChatStatusReplySchema,
  ForgeChatWishReplySchema,
  KingdomIdSchema,
  type ForgeChatWish,
} from '@chatdom/shared';
import { openForge } from '../forge/play';

declare global {
  interface Window {
    __chatdomReady?: boolean; __chatdomForgePanelError?: string;
    __forgeBench?: { release: number; restore: number; closed: number; status: number; wish: number; lastRequestId: string | null; reopen: () => void };
  }
}

const STATES = ['signedout', 'consent', 'ready', 'sent', 'working', 'delivered', 'held', 'cold', 'unknown', 'not-sent', 'rate-limited'] as const;
type State = typeof STATES[number];
const requested = new URLSearchParams(location.search).get('state');
const state: State = STATES.find(value => value === requested) ?? 'ready';
const kingdomId = KingdomIdSchema.parse('123');
const requestId = '00000000-0000-4000-8000-000000000001';
const at = 1_700_000_000_000;
const base = { requestId, kingdomId, updatedAt: at };
const witness = { messageId: 'fixture-message', receiptId: 'forge:fixture' };

function fixtureWish(selected: State): ForgeChatWish | null {
  switch (selected) {
    case 'sent': return { ...base, ...witness, status: 'sent' };
    case 'working': return { ...base, ...witness, status: 'working' };
    case 'delivered': return { ...base, ...witness, status: 'delivered', attachmentId: 'fixture-piece', committedAt: at,
      message: 'A little moon now rests above your door.' };
    case 'held': return { ...base, ...witness, status: 'held', message: 'The Forge is holding this wish for now.' };
    case 'cold': return { ...base, ...witness, status: 'cold', message: 'The hearth has gone cold for now. Try again when the stream is live.' };
    case 'not-sent': return { ...base, status: 'not-sent', reason: 'chat-dropped', message: 'Twitch could not send this wish. Your words are still here.' };
    case 'rate-limited': return { ...base, status: 'not-sent', reason: 'rate-limited', message: 'Please wait before trying again.', retryAt: Date.now() + 60_000 };
    case 'unknown': return { ...base, status: 'unknown', message: 'We could not confirm whether your wish reached chat. Please check chat before trying again.' };
    default: return null;
  }
}

window.__chatdomReady = false;
const diagnostics = { release: 0, restore: 0, closed: 0, status: 0, wish: 0, lastRequestId: null as string | null, reopen: () => {} };
window.__forgeBench = diagnostics;
const readyAfterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__chatdomReady = true; }));
let firstStatus = true;
const transport: NonNullable<Parameters<typeof openForge>[2]> = {
  async session() { if (state === 'signedout') { readyAfterPaint(); return null; } return { resumeScope: 'fixture-citizen' }; },
  async status(id) {
    diagnostics.status++;
    const reply = ForgeChatStatusReplySchema.parse({
      version: 1, status: 'ok', kingdomId: id,
      grant: state === 'signedout' ? { status: 'signed-out' }
        : state === 'consent' ? { status: 'required', reason: 'not-granted' } : { status: 'ready' },
      availability: state === 'cold' ? { status: 'cold', reason: 'stream-offline', message: 'The stream is offline for now.' } : { status: 'ready' },
      wish: fixtureWish(state),
    });
    if (firstStatus) {
      firstStatus = false;
      readyAfterPaint();
    }
    return reply;
  },
  async authorize() {
    throw new Error('This review page does not connect a Twitch account.');
  },
  async wish(id, wishId) {
    diagnostics.wish++; diagnostics.lastRequestId = wishId;
    return ForgeChatWishReplySchema.parse({ version: 1, status: 'accepted', wish: { ...base, kingdomId: id, requestId: wishId, status: 'sending' } }).wish;
  },
};

try {
  const root = document.querySelector<HTMLElement>('#panel');
  if (!root) throw new Error('Panel fixture root is missing.');
  const host = { root, kingdomId, releasePointer() { diagnostics.release++; }, restorePointer() { diagnostics.restore++; }, onClosed() { diagnostics.closed++; } };
  const browser = new URLSearchParams(location.search).get('transport') === 'browser';
  let handle: ReturnType<typeof openForge>;
  const observer = new MutationObserver(() => {
    if (browser && root.querySelector('.forge-wish-body') && !root.textContent?.includes('Checking the Forge…')) readyAfterPaint();
  });
  observer.observe(root, { childList: true, subtree: true });
  diagnostics.reopen = () => {
    if (handle?.isOpen()) return;
    window.__chatdomReady = false;
    handle = browser ? openForge(host, 'hud') : openForge(host, 'hud', transport);
  };
  diagnostics.reopen();
  window.addEventListener('pagehide', () => { observer.disconnect(); handle.dispose(); }, { once: true });
} catch (error) {
  window.__chatdomForgePanelError = error instanceof Error ? error.message : String(error);
  throw error;
}
