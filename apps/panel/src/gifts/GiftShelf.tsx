import { createComputed, createMemo, For, Match, Show, Switch } from 'solid-js';
import type { PanelGiftOffer, PanelGiftShelf } from '../../../../packages/shared/src/panel';
import './gifts.css';

export interface GiftShelfProps {
  readonly shelf: PanelGiftShelf;
  readonly onUse: (sku: string) => void;
  readonly onTarget: (plotId: string) => void;
  readonly onResolve: (intentId: string) => void;
  readonly onMore: () => void;
  readonly onCancelChoice: () => void;
  readonly onReset: () => void;
}

type Offer = PanelGiftOffer & { readonly bits: number };
type OpenShelf = Extract<PanelGiftShelf, { kind: 'open' }>;

/** Group the Helper's actual products under their shared, fixed outcome. */
function grouped(offers: readonly Offer[]): { gift: Offer; bands: Offer[] }[] {
  const groups = new Map<string, { gift: Offer; bands: Offer[] }>();
  for (const offer of offers) {
    const group = groups.get(offer.giftId);
    if (group) group.bands.push(offer);
    else groups.set(offer.giftId, { gift: offer, bands: [offer] });
  }
  return [...groups.values()];
}

function GiftMark() {
  return <span class="gift-mark" aria-hidden="true"><span>✧</span></span>;
}

function GiftList(props: { shelf: OpenShelf; onUse: GiftShelfProps['onUse'] }) {
  const gifts = createMemo(() => grouped(props.shelf.offers));
  return <div class="gift-scroll">
    <header class="gift-intro"><span class="gift-eyebrow">For everyone here</span><h2 tabIndex={-1}>Gifts for the kingdom</h2></header>
    <Show when={gifts().length} fallback={<p class="gift-empty">Gifts open when the channel turns them on.</p>}>
      <ul class="gift-list"><For each={gifts()}>{group => <li class="gift-card">
        <div class="gift-card-head"><span class="gift-card-star" aria-hidden="true">✦</span><div><h3>{group.gift.title}</h3><p>{group.gift.what}</p></div></div>
        <div class="gift-bands" aria-label={`${group.gift.title} in Bits`}><For each={group.bands}>{band =>
          <button type="button" data-gift-sku={band.sku} onClick={() => props.onUse(band.sku)} aria-label={`Give ${group.gift.title}, ${band.bits.toLocaleString('en-US')} Bits`}><strong>{band.bits.toLocaleString('en-US')}</strong><span>Bits</span></button>}
        </For></div>
      </li>}</For></ul>
    </Show>
  </div>;
}

function GiftRequest(props: { shelf: OpenShelf; onTarget: GiftShelfProps['onTarget']; onResolve: GiftShelfProps['onResolve']; onMore: GiftShelfProps['onMore']; onCancelChoice: GiftShelfProps['onCancelChoice']; onReset: GiftShelfProps['onReset'] }) {
  const request = () => props.shelf.request;
  const paidRequest = () => { const current = request(); return current.kind === 'choosing-paid' ? current : null; };
  const paidChoices = () => paidRequest()?.choices ?? [];
  // Keep the pagination control in place if the last page removes its cursor.
  const hadMore = createMemo<boolean>(previous => request().kind === 'choosing-paid' && (previous || !!paidRequest()?.nextCursor), false);
  const selected = () => { const current = request(); return current.kind === 'idle' ? null : props.shelf.offers.find(offer => offer.sku === current.sku); };
  return <div class="gift-request" aria-live="polite">
    <Switch>
      <Match when={request().kind === 'choosing'}>
        <div class="gift-request-head"><span class="gift-eyebrow">{selected()?.title ?? 'A gift'}</span><h2 tabIndex={-1}>Choose a friend</h2><p>A gift for their home, seen by everyone.</p></div>
        <Show when={props.shelf.friends.length} fallback={<p class="gift-empty">No friends are available here yet.</p>}>
          <ul class="gift-friends"><For each={props.shelf.friends}>{friend => <li><button type="button" onClick={() => props.onTarget(friend.plotId)}><span>{friend.name}</span><span aria-hidden="true">›</span></button></li>}</For></ul>
        </Show>
        <button type="button" class="gift-back" onClick={props.onCancelChoice}>‹ Back to gifts</button>
      </Match>
      <Match when={request().kind === 'choosing-paid'}>
        <div class="gift-request-head"><h2 tabIndex={-1}>Choose a gift</h2><p>Choose where this gift goes.</p></div>
        <ul class="gift-friends gift-paid-choices"><For each={paidChoices()}>{choice => <li><button type="button" onClick={() => props.onResolve(choice.intentId)}>
          <span><strong>{choice.title}</strong><small>{choice.targetName ?? (selected()?.target === 'friend' ? 'A home you chose' : 'For the kingdom')} · {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(choice.createdAt)}</small></span><span aria-hidden="true">›</span>
        </button></li>}</For></ul>
        <Show when={hadMore()}><button type="button" class="gift-back" aria-disabled={!paidRequest()?.nextCursor} onClick={() => { if (paidRequest()?.nextCursor) props.onMore(); }}>{paidRequest()?.nextCursor ? "More choices" : "All choices shown"}</button></Show>
      </Match>
      <Match when={request().kind === 'confirming'}><GiftMark /><h2 tabIndex={-1}>Waiting for Twitch</h2><p>Continue in Twitch’s window.</p></Match>
      <Match when={request().kind === 'pending'}><GiftMark /><h2 tabIndex={-1}>On its way</h2><p>Waiting for the kingdom to answer.</p><Show when={request().kind === 'pending' && (request() as Extract<OpenShelf['request'], { kind: 'confirming' | 'pending' | 'cancelled' | 'unavailable' }>).canCancel === true}><button type="button" class="gift-back" onClick={props.onCancelChoice}>Close checkout</button></Show></Match>
      <Match when={request().kind === 'delivered'}><GiftMark /><h2 tabIndex={-1}>Given to the kingdom</h2><p>{request().kind === 'delivered' ? (request() as Extract<OpenShelf['request'], { kind: 'delivered' }>).line : ''}</p><button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button></Match>
      <Match when={request().kind === 'cancelled'}><GiftMark /><h2 tabIndex={-1}>Window closed</h2><p>Twitch’s window was closed.</p><button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button></Match>
      <Match when={request().kind === 'unavailable'}><GiftMark /><h2 tabIndex={-1}>Out of reach</h2><p>The kingdom could not answer just now.</p><button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button></Match>
    </Switch>
  </div>;
}

/** Mounted inside the panel's Gifts tab; its own list is the only scrolling surface. */
export function GiftShelf(props: GiftShelfProps) {
  let root: HTMLElement | undefined;
  let previousState: string | undefined;
  let lastSku: string | undefined;
  const state = () => props.shelf.kind === 'open' ? props.shelf.request.kind : 'closed';

  // Capture focus before the old state is removed; a refresh of the same state does nothing.
  createComputed(() => {
    const next = state();
    const previous = previousState;
    previousState = next;
    if (previous === undefined || previous === next || !root) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !root.contains(focused) || !root.getClientRects().length) return;
    if (focused.dataset.giftSku) lastSku = focused.dataset.giftSku;
    queueMicrotask(() => {
      if (!root || state() !== next || !root.getClientRects().length) return;
      // Respect a person who moved focus elsewhere while the view was changing.
      const active = document.activeElement;
      if (active !== focused && active !== document.body && active !== null && !root.contains(active)) return;
      const action = next === 'idle' && lastSku
        ? [...root.querySelectorAll<HTMLButtonElement>('[data-gift-sku]')].find(button => button.dataset.giftSku === lastSku)
        : undefined;
      (action ?? root.querySelector<HTMLElement>('h2[tabindex]'))?.focus();
    });
  });
  return <section ref={element => { root = element; }} class="gift-shelf" aria-label="Gifts">
    <Show when={props.shelf.kind === 'open' ? props.shelf : null} fallback={<div class="gift-closed"><GiftMark /><h2 tabIndex={-1}>Gifts</h2><p>Gifts open when the channel turns them on.</p></div>}>{shelf =>
      <Show when={shelf().request.kind === 'idle'} fallback={<GiftRequest shelf={shelf()} onTarget={props.onTarget} onResolve={props.onResolve} onMore={props.onMore} onCancelChoice={props.onCancelChoice} onReset={props.onReset} />}>
        <GiftList shelf={shelf()} onUse={props.onUse} />
      </Show>}
    </Show>
  </section>;
}
