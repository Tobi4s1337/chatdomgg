import { createComputed, createMemo, createSignal, For, Match, Show, Switch, untrack } from 'solid-js';
import type { PanelGiftOffer, PanelGiftRequest, PanelGiftShelf } from '../../../../packages/shared/src/panel';
import { DEFAULT_GIFT_IDS } from './catalogue';
import { GiftEmblem } from './emblems';
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
type Group = { readonly gift: Offer; readonly bands: readonly Offer[] };

/** Group the Helper's actual products under their shared, fixed outcome; bands in the order Twitch gives their amounts. */
function grouped(offers: readonly Offer[]): Group[] {
  const groups = new Map<string, Offer[]>();
  for (const offer of offers) {
    const bands = groups.get(offer.giftId);
    if (bands) bands.push(offer); else groups.set(offer.giftId, [offer]);
  }
  return [...groups.values()].map(bands => {
    const sorted = [...bands].sort((a, b) => a.bits - b.bits);
    return { gift: sorted[0]!, bands: sorted };
  });
}

const bits = (amount: number) => amount.toLocaleString('en-US');
/** The amounts Twitch shows for this gift, in Twitch's own unit. */
const amounts = (group: Group) => {
  const low = group.bands[0]!.bits, high = group.bands[group.bands.length - 1]!.bits;
  return low === high ? `${bits(low)} Bits` : `${bits(low)}–${bits(high)} Bits`;
};
/** Every gift ends; none lasts past a day. */
const lasts = (ms: number) => ms <= 60_000 ? 'For a minute' : ms <= 5 * 60_000 ? 'For five minutes' : ms <= 60 * 60_000 ? 'For an hour' : 'For a day';

/** A round brass medallion around the gift's emblem; its ring tells the state apart before any word does. */
function Medallion(props: { giftId: string | undefined; state: 'still' | 'waiting' | 'given' | 'closed' }) {
  return <span class="gift-medallion" data-state={props.state} aria-hidden="true">
    <span class="gift-medallion-rays" />
    <span class="gift-medallion-ring" />
    <GiftEmblem giftId={props.giftId ?? ''} class="gift-medallion-emblem" />
  </span>;
}

function GiftList(props: { groups: readonly Group[]; onOpen: (giftId: string) => void }) {
  return <div class="gift-scroll">
    <header class="gift-intro"><h2 tabIndex={-1}>Gifts for the kingdom</h2><p>Everyone here sees them.</p></header>
    <Show when={props.groups.length} fallback={<p class="gift-empty">Gifts open when the channel turns them on.</p>}>
      <ul class="gift-grid"><For each={props.groups}>{group => <li>
        <button type="button" class="gift-token" data-gift-id={group.gift.giftId} onClick={() => props.onOpen(group.gift.giftId)}
          aria-label={`${group.gift.title}, ${amounts(group)}`}>
          <GiftEmblem giftId={group.gift.giftId} class="gift-token-emblem" />
          <span class="gift-token-title">{group.gift.title}</span>
          <span class="gift-token-bits">{amounts(group)}</span>
        </button>
      </li>}</For></ul>
    </Show>
  </div>;
}

function GiftDetail(props: { group: Group; onUse: (sku: string) => void; onBack: () => void }) {
  const gift = () => props.group.gift;
  return <div class="gift-detail">
    <button type="button" class="gift-back gift-back-top" onClick={props.onBack}>‹ All gifts</button>
    <div class="gift-detail-body">
      <Medallion giftId={gift().giftId} state="still" />
      <h2 tabIndex={-1}>{gift().title}</h2>
      <p>{gift().what}</p>
      <p class="gift-detail-lasts">{lasts(gift().durationMs)}{gift().target === 'friend' ? ' · then choose a friend' : ''}</p>
    </div>
    <div class="gift-give"><For each={props.group.bands}>{band =>
      <button type="button" class="gift-give-button" data-gift-sku={band.sku} onClick={() => props.onUse(band.sku)}
        aria-label={`Give ${gift().title}, ${bits(band.bits)} Bits`}>Give <span aria-hidden="true">·</span> <strong>{bits(band.bits)}</strong> Bits</button>}
    </For></div>
  </div>;
}

function GiftRequest(props: { shelf: OpenShelf; onTarget: GiftShelfProps['onTarget']; onResolve: GiftShelfProps['onResolve']; onMore: GiftShelfProps['onMore']; onCancelChoice: GiftShelfProps['onCancelChoice']; onReset: GiftShelfProps['onReset'] }) {
  const request = () => props.shelf.request;
  const paidRequest = () => { const current = request(); return current.kind === 'choosing-paid' ? current : null; };
  const paidChoices = () => paidRequest()?.choices ?? [];
  // Keep the pagination control in place if the last page removes its cursor.
  const hadMore = createMemo<boolean>(previous => request().kind === 'choosing-paid' && (previous || !!paidRequest()?.nextCursor), false);
  const selected = () => { const current = request(); return current.kind === 'idle' ? undefined : props.shelf.offers.find(offer => offer.sku === current.sku); };
  const canClose = () => { const current = request(); return current.kind === 'pending' && current.canCancel === true; };
  const line = () => { const current = request(); return current.kind === 'delivered' ? current.line : ''; };
  return <div class="gift-request" data-request={request().kind} aria-live="polite">
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
        <Show when={hadMore()}><button type="button" class="gift-back" aria-disabled={!paidRequest()?.nextCursor} onClick={() => { if (paidRequest()?.nextCursor) props.onMore(); }}>{paidRequest()?.nextCursor ? 'More choices' : 'All choices shown'}</button></Show>
      </Match>
      <Match when={request().kind === 'confirming'}>
        <Medallion giftId={selected()?.giftId} state="waiting" /><h2 tabIndex={-1}>Waiting for Twitch</h2><p>Continue in Twitch’s window.</p>
      </Match>
      <Match when={request().kind === 'pending'}>
        <Medallion giftId={selected()?.giftId} state="waiting" /><h2 tabIndex={-1}>On its way</h2><p>Waiting for the kingdom to answer.</p>
        <Show when={canClose()}><button type="button" class="gift-back" onClick={props.onCancelChoice}>Close checkout</button></Show>
      </Match>
      <Match when={request().kind === 'delivered'}>
        <Medallion giftId={selected()?.giftId} state="given" /><h2 tabIndex={-1}>Given to the kingdom</h2><p>{line()}</p>
        <button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button>
      </Match>
      <Match when={request().kind === 'cancelled'}>
        <Medallion giftId={selected()?.giftId} state="closed" /><h2 tabIndex={-1}>Window closed</h2><p>Twitch’s window was closed.</p>
        <button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button>
      </Match>
      <Match when={request().kind === 'unavailable'}>
        <Medallion giftId={selected()?.giftId} state="closed" /><h2 tabIndex={-1}>Out of reach</h2><p>The kingdom could not answer just now.</p>
        <button class="gift-back" type="button" onClick={props.onReset}>Back to gifts</button>
      </Match>
    </Switch>
  </div>;
}

/** The shelf before the channel turns gifts on: the moments on show, behind glass, none of them tappable. */
function ClosedShelf(props: { reason: string }) {
  return <div class="gift-closed">
    <h2 tabIndex={-1}>Gifts</h2>
    <p>{props.reason}</p>
    <div class="gift-display" aria-hidden="true"><For each={DEFAULT_GIFT_IDS}>{giftId => <GiftEmblem giftId={giftId} class="gift-display-emblem" />}</For></div>
  </div>;
}

/** Mounted inside the panel's Gifts tab; its own list is the only scrolling surface. */
export function GiftShelf(props: GiftShelfProps) {
  let root: HTMLElement | undefined;
  let previousState: string | undefined;
  let lastGift: string | undefined;
  const [detail, setDetail] = createSignal<string | null>(null);
  const open = () => props.shelf.kind === 'open' ? props.shelf : null;
  const groups = createMemo(() => { const shelf = open(); return shelf ? grouped(shelf.offers) : []; });
  const request = (): PanelGiftRequest | null => open()?.request ?? null;
  // A gift the channel stops offering closes its page; the shelf never opens one by itself.
  const detailGroup = createMemo(() => { const id = detail(); return id && request()?.kind === 'idle' ? groups().find(group => group.gift.giftId === id) ?? null : null; });
  const state = () => { const current = request(); return !current ? 'closed' : current.kind === 'idle' ? (detailGroup() ? 'detail' : 'idle') : current.kind; };

  const openGift = (giftId: string) => { lastGift = giftId; setDetail(giftId); };
  const use = (sku: string) => {
    lastGift = open()?.offers.find(offer => offer.sku === sku)?.giftId ?? lastGift;
    props.onUse(sku);
  };
  // The page closes when the checkout begins, so focus moves from Give straight to the checkout's heading,
  // and a finished or closed checkout comes back to the shelf with that gift's token in focus.
  createComputed(() => { const current = request(); if (current && current.kind !== 'idle' && untrack(detail)) setDetail(null); });

  // Capture focus before the old state is removed; a refresh of the same state does nothing.
  createComputed(() => {
    const next = state();
    const previous = previousState;
    previousState = next;
    const current = request();
    if (current && current.kind !== 'idle') lastGift = open()?.offers.find(offer => offer.sku === current.sku)?.giftId ?? lastGift;
    if (previous === undefined || previous === next || !root) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !root.contains(focused) || !root.getClientRects().length) return;
    queueMicrotask(() => {
      if (!root || state() !== next || !root.getClientRects().length) return;
      // Respect a person who moved focus elsewhere while the view was changing.
      const active = document.activeElement;
      if (active !== focused && active !== document.body && active !== null && !root.contains(active)) return;
      const token = next === 'idle' && lastGift
        ? [...root.querySelectorAll<HTMLButtonElement>('[data-gift-id]')].find(button => button.dataset.giftId === lastGift)
        : undefined;
      (token ?? root.querySelector<HTMLElement>('h2[tabindex]'))?.focus();
    });
  });
  return <section ref={element => { root = element; }} class="gift-shelf" aria-label="Gifts">
    <Show when={open()} fallback={<ClosedShelf reason={props.shelf.kind === 'closed' ? props.shelf.reason : 'Gifts open when the channel turns them on.'} />}>{shelf =>
      <Switch>
        <Match when={shelf().request.kind !== 'idle'}>
          <GiftRequest shelf={shelf()} onTarget={props.onTarget} onResolve={props.onResolve} onMore={props.onMore} onCancelChoice={props.onCancelChoice} onReset={props.onReset} />
        </Match>
        <Match when={detailGroup()}>{group => <GiftDetail group={group()} onUse={use} onBack={() => setDetail(null)} />}</Match>
        <Match when={true}><GiftList groups={groups()} onOpen={openGift} /></Match>
      </Switch>}
    </Show>
  </section>;
}
