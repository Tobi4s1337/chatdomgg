import type { PanelGiftChoice, PanelGiftFriend, PanelGiftOffer, PanelGiftRequest, PanelGiftShelf } from '../../../../packages/shared/src/panel';
import type { HelperBridge } from '../helper';

interface Options {
  readonly helper: HelperBridge;
  readonly backend: string | null;
  readonly fetch: typeof fetch;
  readonly visible: () => boolean;
  readonly live: () => boolean;
  readonly onChange: () => void;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const words = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(v);
const validOffer = (v: unknown): v is PanelGiftOffer => record(v) && words(v.sku) && words(v.giftId) && words(v.title) && words(v.what, 500) && ['none', 'friend', 'self'].includes(String(v.target)) && Number.isSafeInteger(v.durationMs) && Number(v.durationMs) > 0;
const validChoice = (v: unknown): v is PanelGiftChoice => record(v) && words(v.intentId) && words(v.title) && (v.targetName === null || words(v.targetName)) && Number.isSafeInteger(v.createdAt) && Number(v.createdAt) >= 0;
const validFriend = (v: unknown): v is PanelGiftFriend => record(v) && words(v.plotId) && words(v.name);

/** A purchase is only delivered when the realm returns a committed public fact. */
export function createGiftTransport(options: Options) {
  const { helper, backend, onChange } = options;
  let shelf: PanelGiftShelf = { kind: 'closed', reason: 'Gifts are not available here yet.' };
  let offers: (PanelGiftOffer & { bits: number })[] = [], friends: PanelGiftFriend[] = [];
  let request: PanelGiftRequest = { kind: 'idle' };
  let intent: { id: string; sku: string } | null = null;
  let draft: { requestId: string; sku: string; targetPlotId: string | null } | null = null;
  let epoch = 0, intentGeneration = 0, statusGeneration = 0, disposed = false, busy = false, statusBusy = false, refreshBusy = false, refreshAgain = false, resetAfterRefresh = false;
  let timer: ReturnType<typeof setTimeout> | undefined, retry = 5_000;
  const controllers = new Set<AbortController>();
  const shared = () => { const s = helper.status(); return s.kind === 'authorized' && s.loggedIn && s.shared; };
  const canRead = () => !disposed && options.visible() && shared() && !!backend && !!helper.token();
  const canCheckout = () => { const s = helper.status(); return canRead() && options.live() && s.kind === 'authorized' && s.bits && !!helper.getProducts && !!helper.useBits; };
  const publish = () => {
    shelf = canRead() && (offers.length > 0 || request.kind !== 'idle') ? { kind: 'open', offers, friends, request } : { kind: 'closed', reason: 'Gifts are not available here yet.' };
    onChange();
  };
  const stop = () => { epoch++; clearTimeout(timer); timer = undefined; for (const c of controllers) c.abort(); controllers.clear(); busy = false; statusBusy = false; refreshBusy = false; refreshAgain = false; resetAfterRefresh = false; };
  const post = async (path: string, body: Record<string, unknown>) => {
    const token = helper.token(); if (!backend || !token || !options.visible()) throw new Error('unavailable');
    const controller = new AbortController(); controllers.add(controller);
    try {
      const response = await options.fetch(`${backend}/api/panel/v1/${path}`, { method: 'POST', signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok || controller.signal.aborted) throw new Error('unavailable');
      const text = await response.text(); if (text.length > 64 * 1024 || controller.signal.aborted) throw new Error('unavailable');
      return JSON.parse(text) as unknown;
    } finally { controllers.delete(controller); }
  };
  const consumeResult = (result: unknown, current: { id: string; sku: string }) => {
    if (!record(result) || result.version !== 1) throw new Error('unavailable');
    if (result.status === 'delivered' && record(result.fact) && result.fact.version === 1 && result.fact.type === 'panel.gift' && words(result.fact.line, 500)) {
      request = { kind: 'delivered', sku: current.sku, line: result.fact.line }; intent = null; intentGeneration++; retry = 5_000;
    } else if (result.status === 'cancelled') {
      request = { kind: 'cancelled', sku: current.sku }; intent = null; intentGeneration++; draft = null; clearTimeout(timer); timer = undefined;
    } else if (result.status === 'pending') { request = { kind: 'pending', sku: current.sku, canCancel: result.canCancel === true }; retry = 5_000; }
    else if (result.status === 'awaiting-target' && words(result.paymentRef) && Array.isArray(result.choices) && result.choices.length > 0 && result.choices.every(validChoice)) {
      if (result.nextCursor != null && !words(result.nextCursor, 500)) throw new Error('unavailable');
      request = { kind: 'choosing-paid', sku: current.sku, paymentRef: result.paymentRef, choices: result.choices, ...(typeof result.nextCursor === 'string' ? { nextCursor: result.nextCursor } : {}) };
    } else throw new Error('unavailable');
  };
  const checkStatus = async () => {
    if (!intent || !canRead() || statusBusy) return;
    const current = intent, version = epoch, generation = ++statusGeneration; statusBusy = true;
    try {
      const result = await post('gift-status', { intentId: current.id });
      if (version !== epoch || intent !== current) return;
      consumeResult(result, current);
    } catch { if (version === epoch && intent === current) { request = { kind: 'pending', sku: current.sku }; retry = Math.min(retry * 2, 60_000); } }
    finally {
      if (version === epoch && generation === statusGeneration) { statusBusy = false; if (intent === current && request.kind === 'pending' && canRead()) timer = setTimeout(() => { timer = undefined; void checkStatus(); }, retry); publish(); }
    }
  };
  const refresh = async () => {
    if (!canRead()) { offers = []; publish(); return false; }
    if (refreshBusy) { refreshAgain = true; return false; }
    refreshBusy = true; const version = epoch, generation = intentGeneration;
    let succeeded = false;
    try {
      const [wire, products] = await Promise.all([post('gifts', {}), canCheckout() ? helper.getProducts!().catch(() => []) : Promise.resolve([])]);
      if (version !== epoch || !canRead()) return;
      if (!record(wire) || wire.version !== 1 || wire.status !== 'gifts' || !['live', 'resting'].includes(String(wire.stream)) || !Array.isArray(wire.offers) || !wire.offers.every(validOffer) || !Array.isArray(wire.friends) || !wire.friends.every(validFriend)) throw new Error('unavailable');
      if (wire.activeIntent != null && (!record(wire.activeIntent) || !words(wire.activeIntent.intentId) || !words(wire.activeIntent.sku))) throw new Error('unavailable');
      if (!intent && generation === intentGeneration && wire.activeIntent != null && record(wire.activeIntent) && words(wire.activeIntent.intentId) && words(wire.activeIntent.sku)) {
        intent = { id: wire.activeIntent.intentId, sku: wire.activeIntent.sku };
        request = { kind: 'pending', sku: intent.sku }; draft = null;
      }
      const now = Date.now();
      offers = canCheckout() && wire.stream === 'live' ? wire.offers.flatMap(offer => {
        const product = products.find(p => p.sku === offer.sku && /^\d+$/.test(String(p.cost?.amount)) && Number.isSafeInteger(Number(p.cost.amount)) && Number(p.cost.amount) > 0 && p.cost.type === 'bits' && (!p.expiration || Date.parse(p.expiration) > now));
        return product ? [{ ...offer, bits: Number(product.cost.amount) }] : [];
      }) : []; friends = wire.friends;
      if (intent && request.kind === 'pending' && !timer) void checkStatus();
      succeeded = true;
    } catch { if (version === epoch) { offers = []; friends = []; } }
    if (version === epoch) { refreshBusy = false; if (resetAfterRefresh && !refreshAgain) { resetAfterRefresh = false; if (succeeded && !intent) request = { kind: 'idle' }; } publish(); if (refreshAgain) { refreshAgain = false; void refresh(); } }
    return succeeded;
  };
  const begin = async (sku: string, targetPlotId: string | null) => {
    if (!canCheckout() || busy || intent || !offers.some(o => o.sku === sku)) return;
    if (draft && (draft.sku !== sku || draft.targetPlotId !== targetPlotId)) return;
    draft ??= { requestId: crypto.randomUUID(), sku, targetPlotId };
    busy = true; request = { kind: 'confirming', sku }; publish(); const version = epoch;
    try {
      const result = await post('gift-intent', draft);
      if (version !== epoch || !canCheckout()) return;
      if (!record(result) || result.version !== 1 || result.status !== 'intent' || result.sku !== sku || !words(result.intentId)) throw new Error('unavailable');
      intent = { id: result.intentId, sku }; draft = null;
      if (!helper.useBits?.(sku)) { request = { kind: 'pending', sku }; void checkStatus(); }
    } catch { if (version === epoch) request = { kind: 'unavailable', sku }; }
    finally { if (version === epoch) { busy = false; publish(); } }
  };
  const unsubComplete = helper.onGiftTransaction?.(transaction => {
    if (!intent || transaction.initiator !== 'current_user' || (transaction.product?.sku && transaction.product.sku !== intent.sku)) return;
    const current = intent, version = epoch; request = { kind: 'pending', sku: current.sku }; publish();
    if (!canRead()) return;
    if (!transaction.transactionReceipt) { void checkStatus(); return; }
    void post('gift-receipt', { intentId: current.id, receipt: transaction.transactionReceipt }).catch(() => undefined).finally(() => { if (version === epoch && intent === current) void checkStatus(); });
  });
  const cancelIntent = (current: { id: string; sku: string }) => {
    if (!canRead() || busy) return;
    const version = epoch; busy = true;
    void post('gift-cancel', { intentId: current.id }).then(result => {
      if (version !== epoch || intent !== current) return;
      if (record(result) && result.version === 1 && result.status === 'cancelled') {
        intent = null; intentGeneration++; draft = null; clearTimeout(timer); timer = undefined;
        request = { kind: 'cancelled', sku: current.sku };
      } else consumeResult(result, current);
    }).catch(() => {
      if (version === epoch && intent === current) request = { kind: 'pending', sku: current.sku };
    }).finally(() => {
      if (version === epoch) { busy = false; publish(); if (intent === current && request.kind === 'pending' && !timer) void checkStatus(); }
    });
  };
  const unsubCancel = helper.onGiftCancelled?.(() => {
    if (!intent) return;
    const current = intent; request = { kind: 'cancelled', sku: current.sku }; publish(); cancelIntent(current);
  });
  return {
    get: () => shelf,
    refresh,
    suspend() { stop(); offers = []; publish(); },
    clearIdentity() { stop(); intent = null; draft = null; request = { kind: 'idle' }; offers = []; friends = []; publish(); },
    requestProduct(sku: string) {
      const offer = offers.find(o => o.sku === sku); if (!canCheckout() || !offer || busy || intent || request.kind !== 'idle') return;
      if (offer.target === 'friend') { request = { kind: 'choosing', sku }; publish(); } else void begin(sku, null);
    },
    chooseGiftTarget(plotId: string) { if (request.kind === 'choosing' && friends.some(f => f.plotId === plotId)) void begin(request.sku, plotId); },
    cancelGiftChoice() { if (request.kind === 'choosing') { request = { kind: 'idle' }; publish(); } else if (request.kind === 'pending' && request.canCancel === true && intent) { cancelIntent(intent); } },
    resetGift() {
      if (request.kind === 'unavailable') {
        draft = null; resetAfterRefresh = true; void refresh();
      } else if (request.kind === 'delivered' || (request.kind === 'cancelled' && !intent)) { request = { kind: 'idle' }; publish(); }
      else if (request.kind === 'cancelled' && intent) { request = { kind: 'pending', sku: intent.sku }; publish(); void checkStatus(); }
    },
    resolveGiftIntent(intentId: string) {
      if (request.kind !== 'choosing-paid' || !intent || !canRead() || busy || !request.choices.some(choice => choice.intentId === intentId)) return;
      const paymentRef = request.paymentRef, version = epoch;
      const current = { id: intentId, sku: intent.sku }; intent = current; intentGeneration++; statusGeneration++; statusBusy = false; clearTimeout(timer); timer = undefined;
      busy = true; request = { kind: 'pending', sku: current.sku }; publish();
      void post('gift-resolve', { paymentRef, intentId }).then(result => {
        if (version !== epoch || intent !== current) return;
        consumeResult(result, current);
      }).catch(() => { if (version === epoch && intent === current) request = { kind: 'pending', sku: current.sku }; }).finally(() => {
        if (version === epoch) { busy = false; publish(); if (intent === current && request.kind === 'pending') void checkStatus(); }
      });
    },
    moreGiftChoices() {
      if (request.kind !== 'choosing-paid' || !request.nextCursor || !intent || !canRead() || busy) return;
      const current = intent, paymentRef = request.paymentRef, cursor = request.nextCursor, version = epoch;
      busy = true;
      void post('gift-choices', { paymentRef, cursor }).then(result => {
        if (version !== epoch || intent !== current || request.kind !== 'choosing-paid') return;
        if (!record(result) || result.version !== 1 || result.status !== 'awaiting-target' || result.paymentRef !== paymentRef || !Array.isArray(result.choices) || !result.choices.every(validChoice) || (result.nextCursor != null && !words(result.nextCursor, 500))) return;
        request = { kind: 'choosing-paid', sku: current.sku, paymentRef, choices: result.choices, ...(typeof result.nextCursor === 'string' ? { nextCursor: result.nextCursor } : {}) };
      }).catch(() => undefined).finally(() => { if (version === epoch) { busy = false; publish(); } });
    },
    dispose() { disposed = true; stop(); unsubComplete?.(); unsubCancel?.(); },
  };
}
