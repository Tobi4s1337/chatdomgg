// Development-only entry. It is not an Extension build input.
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelGiftOffer, PanelGiftRequest, PanelGiftShelf } from '../../../../packages/shared/src/panel';
import { GiftShelf } from './GiftShelf';
import { DEFAULT_GIFT_IDS, GIFT_CATALOGUE } from './catalogue';
import '../panel.css';
import '../window.css';

const offers: (PanelGiftOffer & { bits: number })[] = GIFT_CATALOGUE.filter(gift => DEFAULT_GIFT_IDS.includes(gift.id)).map(gift => { const band = gift.bands[0]; return ({
  sku: band.id, giftId: gift.id, title: gift.title, what: gift.what, target: gift.target, durationMs: gift.durationMs, bits: band.suggestedBits,
}); });
const friends = [{ plotId: 'plot1', name: 'Wren' }, { plotId: 'plot2', name: 'Moss' }, { plotId: 'plot3', name: 'Juniper' }];
const state = new URLSearchParams(location.search).get('state') ?? 'open';
const request: PanelGiftRequest = state === 'choosing-paid' ? { kind: 'choosing-paid', sku: 'friendfireworksa', paymentRef: 'bench', nextCursor: 'next', choices: [
  { intentId: 'first', title: 'Fireworks for a friend', targetName: 'Wren', createdAt: new Date(2026, 10, 1, 20, 12).getTime() },
  { intentId: 'second', title: 'Fireworks for a friend', targetName: 'Moss', createdAt: new Date(2026, 10, 1, 20, 18).getTime() },
] } : state === 'choosing' ? { kind: 'choosing', sku: 'friendfireworksa' }
  : state === 'pending' ? { kind: 'pending', sku: 'kitesa', canCancel: true }
  : state === 'confirming' || state === 'cancelled' || state === 'unavailable' ? { kind: state, sku: 'kitesa' }
  : state === 'delivered' ? { kind: 'delivered', sku: 'kitesa', line: 'Kites are crossing the sky.' } : { kind: 'idle' };
function Bench() {
  onMount(() => { void document.fonts.ready.then(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }); });
  const [current, setCurrent] = createSignal<PanelGiftRequest>(request);
  const shelf = (): PanelGiftShelf => state === 'closed' ? { kind: 'closed', reason: 'Gifts open when the channel turns them on.' } : { kind: 'open', offers, friends, request: current() };
  return <div class="cp-frame"><div class="cp cw"><header class="cw-head"><span class="cw-mark">✦</span><h1>The kingdom</h1></header><main class="cw-main"><GiftShelf shelf={shelf()} onUse={sku => setCurrent({ kind: offers.find(offer => offer.sku === sku)?.target === 'friend' ? 'choosing' : 'confirming', sku })} onTarget={() => setCurrent({ kind: 'confirming', sku: 'friendfireworksa' })} onResolve={() => setCurrent({ kind: 'pending', sku: 'friendfireworksa' })} onMore={() => {}} onCancelChoice={() => setCurrent({ kind: 'idle' })} onReset={() => setCurrent({ kind: 'idle' })} /></main><nav class="cw-nav" aria-label="Panel"><button>Kingdom</button><button>You</button><button aria-current="page">Gifts</button></nav></div></div>;
}
const root = document.getElementById('root');
if (root) render(() => <Bench />, root);
