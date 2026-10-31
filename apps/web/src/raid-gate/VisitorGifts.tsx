import { For, Show } from 'solid-js';
import type { GateDenial, GiftKind, GiftStory, PersonId, VisitorGiftView, WelcomeView } from '../../../api/src/raid-gate/contracts';
import { incoming, type WelcomeSnapshot } from './welcome';

/**
 * Gifts at the gate (spec 23 R9, RG10): what hosts offer a visitor to carry home, what the visitor left with them, and the
 * visitor's own things they may leave. Every line is the authority's: an offer is shown as taken only once its receipt
 * exists, and an answer that was lost reads as being checked. No prices, no rank, nothing owed; refusing is always fine.
 */
export type GiftActions = Readonly<{
  accept(offerId: string): void;
  refuse(offerId: string): void;
  /** Offers one of the viewer's own things to `recipient`. */
  leave(itemId: string, recipient: PersonId): void;
}>;

/** Shelf items shown at once; the rest wait for the next visit. */
const SHELF_SHOWN = 3;

export function VisitorGiftPane(props: { welcome: WelcomeSnapshot; hostName: string; actions: GiftActions; now: number }) {
  const view = () => props.welcome.view;
  const offered = () => (view()?.offers ?? []).filter(offer => incoming(view()!, offer) && offer.state === 'offered');
  const settled = () => (view()?.offers ?? []).filter(offer => !(incoming(view()!, offer) && offer.state === 'offered')).slice(0, 4);
  const canLeave = () => view()?.viewer === 'visitor' && view()?.arrival?.present === true && (view()?.shelf.length ?? 0) > 0;
  const busy = (key: string) => props.welcome.busy?.key === key;
  return <section class="rg-gifts" aria-label={`Gifts at the gate of ${props.hostName}`}>
    <Show when={props.welcome.notice}>{notice => <p class="rg-notice" role="alert">{giftNotice(notice())}</p>}</Show>
    <For each={offered()}>{offer => {
      const checking = () => props.welcome.checking.includes(offer.offerId);
      return <article class="rg-gift" data-kind={offer.story.kind} aria-label={`${offer.story.title}, offered by ${offer.fromName ?? 'a host'}`}>
        <span class="rg-gift-string" aria-hidden="true" />
        <GiftMedal kind={offer.story.kind} />
        <div class="rg-gift-words">
          <p class="rg-gift-eyebrow">{offer.fromName ?? 'A host'} offers you</p>
          <h3 class="rg-gift-title">{offer.story.title}</h3>
          <p class="rg-gift-story">{storyLine(offer.story)}</p>
          <Show when={checking()} fallback={
            <div class="rg-gift-actions">
              <button class="rg-button rg-primary" disabled={props.welcome.busy !== null} aria-busy={busy(offer.offerId)} onClick={() => props.actions.accept(offer.offerId)}>
                {busy(offer.offerId) && props.welcome.busy?.kind === 'accept' ? 'Taking it…' : 'Take it home'}
              </button>
              <button class="rg-button rg-subtle" disabled={props.welcome.busy !== null} onClick={() => props.actions.refuse(offer.offerId)}>Leave it with them</button>
            </div>
          }>
            <p class="rg-checking" role="status"><span>Checking whether it's yours. Nothing is taken twice, and nothing is lost.</span></p>
          </Show>
          <p class="rg-gift-time">Offered for {minutes(offer.expiresAt, props.now)} more · it stays theirs until you take it</p>
        </div>
      </article>;
    }}</For>
    <Show when={settled().length > 0}>
      <ul class="rg-gift-ledger">
        <For each={settled()}>{offer => <li data-state={offer.state}>
          <span class="rg-gift-stamp" aria-hidden="true"><GiftGlyph kind={offer.story.kind} /></span>
          <span>{ledgerLine(view()!, offer)}</span>
        </li>}</For>
      </ul>
    </Show>
    <Show when={canLeave()}>
      <div class="rg-gift-shelf">
        <p class="rg-gift-eyebrow">Leave something with {view()!.monarch.name ?? `${props.hostName}'s monarch`}</p>
        <ul>
          <For each={view()!.shelf.slice(0, SHELF_SHOWN)}>{item => <li>
            <button class="rg-gift-chip" disabled={props.welcome.busy !== null} aria-busy={busy(item.itemId)}
              aria-label={`Leave ${item.story.title} with ${view()!.monarch.name ?? 'the monarch'}`}
              onClick={() => props.actions.leave(item.itemId, view()!.monarch.personId)}>
              <GiftGlyph kind={item.story.kind} /><span>{item.story.title}</span>
            </button>
          </li>}</For>
        </ul>
        <p class="rg-quiet">Only things you made, found or were given can be left. Your light, your home and your keepsakes stay yours.</p>
      </div>
    </Show>
  </section>;
}

const KIND_VERB: Readonly<Record<GiftKind, string>> = { forged: 'Forged', crafted: 'Made', found: 'Found', 'welcome-offering': 'Baked for guests' };

/** The thing's own story: who made it, and where. Unnamed makers stay unnamed. */
export function storyLine(story: GiftStory): string {
  const verb = KIND_VERB[story.kind];
  if (story.makerName && story.originName) return `${verb} by ${story.makerName} in ${story.originName}`;
  if (story.makerName) return `${verb} by ${story.makerName}`;
  if (story.originName) return `${verb} in ${story.originName}`;
  return `${verb} by a maker who keeps their name`;
}

function ledgerLine(view: WelcomeView, offer: VisitorGiftView): string {
  const toMe = incoming(view, offer);
  const other = (toMe ? offer.fromName : offer.toName) ?? (toMe ? 'A host' : 'your host');
  const title = offer.story.title;
  switch (offer.state) {
    case 'accepted': return toMe ? `${title} is yours, from ${other}. It travels home with you, its story kept.` : `${other} kept your ${lower(title)}, with your name in its story.`;
    case 'offered': return `Waiting for ${other} to take your ${lower(title)}. It stays yours until they do.`;
    case 'refused': return toMe ? `You left ${lower(title)} with ${other}.` : `${other} left your ${lower(title)} with you.`;
    case 'expired': return toMe ? `${other}'s offer of ${lower(title)} ran out. Nothing moved.` : `Your offer of ${lower(title)} ran out. It's still yours.`;
    case 'rejected': return `${title} had already changed hands, so nothing moved.`;
    case 'unknown': return `Checking what became of ${lower(title)}.`;
  }
}

const lower = (title: string) => /^(A|An|The) /.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title;

function minutes(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return left === 1 ? 'a minute' : `${left} minutes`;
}

function giftNotice(notice: GateDenial | 'unreachable'): string {
  switch (notice) {
    case 'unreachable': return "Couldn't reach the gatekeeper. Nothing moved; ask again in a moment.";
    case 'full': return 'There are already a few gifts waiting around your visit. Let those be answered first.';
    case 'stale': return 'That gift has moved on. This is how things stand now.';
    case 'unauthorized': return "That can't be given here. Nothing moved.";
    case 'unavailable': return "Gifts can't be given at this gate right now. Nothing moved.";
    case 'invalid': return "That didn't look right, so nothing moved.";
  }
}

/** A brass medal with the kind of thing pressed into it. */
function GiftMedal(props: { kind: GiftKind }) {
  return <span class="rg-gift-medal" aria-hidden="true"><GiftGlyph kind={props.kind} /></span>;
}

function GiftGlyph(props: { kind: GiftKind }) {
  const paths: Readonly<Record<GiftKind, string[]>> = {
    // An anvil with a spark leaving it.
    forged: ['M4 10h12c0 2.4-1.8 4-4 4h-1v3h3v2H7v-2h3v-3H9c-2.6 0-5-1.6-5-4Z', 'M16 10h3.5c0 1.4-1 2.2-2.4 2.2', 'M18 4l1 2.2M20.6 5.6l-1.4 1.5M15.6 5.2l1.6 1.4'],
    // A needle trailing thread.
    crafted: ['M5 19 18 6', 'M18 6a1.4 1.4 0 1 1 1 1', 'M5 19c3-1 3-4 6-4s3 3 6 2'],
    // A leaf and its vein.
    found: ['M5 19C5 10 11 5 19 5c0 8-5 14-14 14Z', 'M5 19 15 9'],
    // A round loaf scored for the oven.
    'welcome-offering': ['M4 15c0-4.4 3.6-8 8-8s8 3.6 8 8v2H4Z', 'M9 9.6l1.6 3M12.4 8.6l1 3.2M15.6 9.8l-.2 3'],
  };
  return <svg class="rg-glyph rg-gift-glyph" viewBox="0 0 24 24" aria-hidden="true"><For each={paths[props.kind]}>{d => <path d={d} />}</For></svg>;
}
