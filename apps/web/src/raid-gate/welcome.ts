/**
 * The welcome at a destination, in the browser (spec 23 R9, RG10). Like the gate controller it holds no authority: it
 * shows what the server last said about one arrival (a visitor's own) or about the guests in a host's kingdom, and asks
 * the server to offer, accept or refuse a gift. A press whose answer was lost is asked again under the same request ID,
 * which the server answers with what already happened, so a gift is never offered twice or taken twice by a retry.
 */
import type { GateCommand, GateDenial, GateReply, PersonId, VisitorGiftView, WelcomeView } from '../../../api/src/raid-gate/contracts';
import type { RaidGateApi } from './ports';

export type WelcomePorts = Readonly<{
  api: RaidGateApi;
  clock: () => number;
  /** Fresh request IDs; defaults to `crypto.randomUUID`. */
  ids?: () => string;
  /** Pauses between asks; tests inject an instant one. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How often the welcome is read again while open (offers arrive from other people). 0 reads only on demand. */
  pollMs?: number;
}>;

export type GiftPress = Readonly<{ kind: 'accept' | 'refuse' | 'offer'; key: string }>;

export type WelcomeSnapshot = Readonly<{
  status: 'loading' | 'ready' | 'unreachable' | 'denied';
  origin: 'live' | 'simulated';
  view: WelcomeView | null;
  /** Offers whose answer was lost: the authority is being asked again. Never shown as taken until it says so. */
  checking: readonly string[];
  /** What this viewer is waiting on: an offer ID for an answer, an item ID for a gift being offered. */
  busy: GiftPress | null;
  notice: GateDenial | 'unreachable' | null;
}>;

export interface GuestWelcomeController {
  snapshot(): WelcomeSnapshot;
  subscribe(listener: (snapshot: WelcomeSnapshot) => void): () => void;
  refresh(): Promise<void>;
  accept(offerId: string): Promise<void>;
  refuse(offerId: string): Promise<void>;
  /** Offers one of the viewer's own things to `recipient` around `arrivalId`. */
  offer(itemId: string, recipient: PersonId, arrivalId: string): Promise<void>;
  dispose(): void;
}

/** Whether this offer comes to the viewer (rather than from them). */
export const incoming = (view: WelcomeView, offer: VisitorGiftView): boolean => (view.viewer === 'visitor') === (offer.direction === 'brought-back');

const POLL_MS = 5_000;
const RETRIES = 3;
const RETRY_MS = 1_500;

export function createGuestWelcomeController(ports: WelcomePorts, arrivalId: string | null): GuestWelcomeController {
  const { api } = ports;
  const ids = ports.ids ?? (() => crypto.randomUUID());
  const wait = ports.wait ?? ((ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }));
  const life = new AbortController();
  const listeners = new Set<(snapshot: WelcomeSnapshot) => void>();
  let view: WelcomeView | null = null;
  let status: WelcomeSnapshot['status'] = 'loading';
  let busy: GiftPress | null = null;
  let notice: WelcomeSnapshot['notice'] = null;
  const checking = new Set<string>();
  let reads = 0;

  const snapshot = (): WelcomeSnapshot => ({ status, origin: api.origin, view, checking: [...checking], busy, notice });
  const emit = () => { if (!life.signal.aborted) { const next = snapshot(); for (const listener of listeners) listener(next); } };

  async function ask(command: GateCommand): Promise<GateReply | null> {
    try { return await api.request(command, life.signal); } catch { return null; }
  }

  /** Takes one offer's newest answer into the welcome. */
  function applyGift(gift: VisitorGiftView): void {
    checking.delete(gift.offerId);
    if (!view || gift.kingdomId !== view.kingdomId) return;
    const held = view.offers.find(each => each.offerId === gift.offerId);
    if (held && held.revision > gift.revision) return;
    const offers = held ? view.offers.map(each => each.offerId === gift.offerId ? gift : each) : [gift, ...view.offers];
    // A thing offered or given away is no longer on the viewer's shelf; the next read confirms it.
    const shelf = gift.state === 'offered' || gift.state === 'accepted' ? view.shelf.filter(item => item.itemId !== gift.itemId || incoming(view!, gift)) : view.shelf;
    view = { ...view, offers, shelf };
  }

  async function refresh(): Promise<void> {
    const mine = ++reads;
    const reply = await ask({ op: 'welcome', arrivalId });
    if (mine !== reads || life.signal.aborted) return;
    if (reply?.kind === 'welcome') {
      view = reply.value; status = 'ready';
      // An offer the authority now tells is no longer in question.
      for (const offerId of [...checking]) {
        const told = view.offers.find(each => each.offerId === offerId);
        if (told && told.state !== 'offered') checking.delete(offerId);
      }
      if (notice === 'unreachable') notice = null;
    } else if (reply?.kind === 'denied') {
      status = view ? 'ready' : 'denied'; notice = reply.code;
    } else if (!view) {
      status = 'unreachable';
    }
    emit();
  }

  /** Sends one press, and on a lost answer the same press again: the authority answers with what already happened. */
  async function press(kind: GiftPress['kind'], key: string, command: GateCommand): Promise<void> {
    if (busy) return;
    busy = { kind, key }; notice = null; emit();
    let reply: GateReply | null = null;
    for (let attempt = 0; attempt < RETRIES && !life.signal.aborted; attempt++) {
      reply = await ask(command);
      if (reply) break;
      if (kind !== 'offer') checking.add(key);
      emit();
      await wait(RETRY_MS, life.signal);
    }
    if (life.signal.aborted) return;
    busy = null;
    if (reply?.kind === 'gift') applyGift(reply.value);
    else if (reply?.kind === 'denied') notice = reply.code;
    else notice = 'unreachable';
    emit();
    void refresh();
  }

  void refresh();
  const every = ports.pollMs ?? POLL_MS;
  if (every > 0) void (async () => {
    while (!life.signal.aborted) {
      await wait(every, life.signal);
      if (!life.signal.aborted && !busy) await refresh();
    }
  })();

  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    accept: offerId => press('accept', offerId, { op: 'accept-gift', requestId: ids(), offerId }),
    refuse: offerId => press('refuse', offerId, { op: 'refuse-gift', requestId: ids(), offerId }),
    offer: (itemId, recipient, arrival) => press('offer', itemId, { op: 'offer-gift', requestId: ids(), itemId, recipient, arrivalId: arrival }),
    dispose() { life.abort(); listeners.clear(); },
  };
}
