// Development-only entry. It is not an Extension build input.
// The real panel, opened on its Gifts tab, with the shelf driven through every state by hand.
import { render } from 'solid-js/web';
import type { PanelGiftOffer, PanelGiftRequest, PanelGiftShelf } from '../../../../packages/shared/src/panel';
import Panel from '../Panel';
import { createFixtureAdapter } from '../adapters/fixture';
import type { PanelAdapter, PanelSnapshot } from '../model';
import { DEFAULT_GIFT_IDS, GIFT_CATALOGUE } from './catalogue';

const offers: (PanelGiftOffer & { bits: number })[] = GIFT_CATALOGUE.filter(gift => DEFAULT_GIFT_IDS.includes(gift.id)).map(gift => {
  const band = gift.bands[0];
  return { sku: band.id, giftId: gift.id, title: gift.title, what: gift.what, target: gift.target, durationMs: gift.durationMs, bits: band.suggestedBits };
});
const friends = [{ plotId: 'plot1', name: 'Wren' }, { plotId: 'plot2', name: 'Moss' }, { plotId: 'plot3', name: 'Juniper' }];
const state = new URLSearchParams(location.search).get('state') ?? 'open';
// 'detail' is the open shelf with one gift's page turned to, as a tap on its token does.
const detailOf = state === 'detail' ? 'friendfireworks' : null;
const first: PanelGiftRequest = state === 'choosing-paid' ? { kind: 'choosing-paid', sku: 'friendfireworksa', paymentRef: 'bench', nextCursor: 'next', choices: [
  { intentId: 'first', title: 'Fireworks for a friend', targetName: 'Wren', createdAt: new Date(2026, 10, 1, 20, 12).getTime() },
  { intentId: 'second', title: 'Fireworks for a friend', targetName: 'Moss', createdAt: new Date(2026, 10, 1, 20, 18).getTime() },
] } : state === 'choosing' ? { kind: 'choosing', sku: 'friendfireworksa' }
  : state === 'pending' ? { kind: 'pending', sku: 'kitesa', canCancel: true }
  : state === 'confirming' || state === 'cancelled' || state === 'unavailable' ? { kind: state, sku: 'kitesa' }
  : state === 'delivered' ? { kind: 'delivered', sku: 'kitesa', line: 'Kites are crossing the sky.' } : { kind: 'idle' };

function benchAdapter(): PanelAdapter {
  const base = createFixtureAdapter('named');
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  let request = first;
  const shelf = (): PanelGiftShelf => state === 'closed' ? { kind: 'closed', reason: 'Gifts open when the channel turns them on.' } : { kind: 'open', offers, friends, request };
  const snapshot = (): PanelSnapshot => ({ ...base.get(), gifts: shelf() });
  const set = (next: PanelGiftRequest) => { request = next; const value = snapshot(); for (const listener of listeners) listener(value); };
  const unlisten = base.subscribe(() => { const value = snapshot(); for (const listener of listeners) listener(value); });
  return {
    ...base,
    get: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    requestProduct: sku => set({ kind: offers.find(offer => offer.sku === sku)?.target === 'friend' ? 'choosing' : 'confirming', sku }),
    chooseGiftTarget: () => set({ kind: 'confirming', sku: 'friendfireworksa' }),
    resolveGiftIntent: () => set({ kind: 'pending', sku: 'friendfireworksa' }),
    moreGiftChoices: () => {},
    cancelGiftChoice: () => set({ kind: 'idle' }),
    resetGift: () => set({ kind: 'idle' }),
    dispose: () => { unlisten(); listeners.clear(); base.dispose(); },
  };
}

const root = document.getElementById('root');
// The 318 px slot under the video, or the phone sheet, as panel.html and mobile.html set it.
document.body.dataset.surface = new URLSearchParams(location.search).get('surface') ?? (innerWidth > 340 ? 'mobile' : 'panel');
if (root) {
  render(() => <Panel adapter={benchAdapter()} initialTab="gifts" />, root);
  if (detailOf) root.querySelector<HTMLButtonElement>(`[data-gift-id="${detailOf}"]`)?.click();
  // A still shows each state as a viewer sees it once settled: one-shot entrances run to their end (the
  // tunnelled capture browser does not advance CSS animations); endless ones, like the waiting ring, keep going.
  void document.fonts.ready.then(() => {
    for (const animation of document.getAnimations()) if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
  });
}
