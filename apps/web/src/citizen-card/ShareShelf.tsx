import { Match, Show, Switch, createSignal, onCleanup, type JSX } from 'solid-js';
import type { CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import type { CardHost, CardShareLinks } from './host';
import { printOf } from './share';

type Copy = 'idle' | 'copying' | 'copied' | 'failed';
type Picture = 'loading' | 'shown' | 'failed';

/**
 * Sharing a card from its page: the picture its link unfurls into (the card, and the passport open on its newest
 * journeys when the travels are shown), pinned under the plaque like a print, with its link to copy. The host
 * supplies the canonical page and image after authorization; without them there is no shelf, and nothing pretends
 * to share. Copying is acknowledged only once the clipboard says it worked; when it cannot, the link is laid out
 * to select by hand.
 */
export function ShareShelf(props: { document: CitizenCardDocument; links: CardShareLinks; host: CardHost }): JSX.Element {
  const print = printOf(props.links.imageUrl, props.document);
  const page = () => new URL(props.links.pageUrl, window.location.href).href;
  const [copy, setCopy] = createSignal<Copy>('idle');
  const [picture, setPicture] = createSignal<Picture>('loading');
  const travels = () => !props.document.passport.hidden;
  let field: HTMLInputElement | undefined;
  let alive = true;
  onCleanup(() => { alive = false; });

  const copyLink = async () => {
    if (copy() === 'copying') return;
    props.host.cue?.('press');
    setCopy('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard here');
      await navigator.clipboard.writeText(page());
      if (alive) setCopy('copied');
    } catch {
      if (!alive) return;
      setCopy('failed');
      queueMicrotask(() => { field?.focus(); field?.select(); });
    }
  };

  return <aside class="cc-share" aria-labelledby="cc-share-title" data-picture={picture()}>
    <figure class="cc-print">
      <span class="cc-print-pin" aria-hidden="true" />
      <div class="cc-print-paper">
        <Show when={picture() !== 'failed'} fallback={<p class="cc-print-missing">The picture could not be drawn just now. The link still opens the card.</p>}>
          <img src={print} width="1200" height="630" decoding="async"
            alt={`${props.document.identity.name}’s card as a picture${travels() ? ', with their passport open beside it' : ''}`}
            onLoad={() => setPicture('shown')} onError={() => setPicture('failed')} />
        </Show>
      </div>
      <figcaption class="cc-print-caption">What the link shows when it is posted</figcaption>
    </figure>
    <div class="cc-share-words">
      <h2 id="cc-share-title" class="cc-share-title">Share this card</h2>
      <p class="cc-share-note">
        {travels()
          ? 'Post the link anywhere and it opens as this picture: the card, with the passport lying beside it.'
          : 'Post the link anywhere and it opens as this picture of the card. The travels are kept private, so no book lies beside it.'}
        {' '}It is drawn fresh each time; copies already saved stay where they are.
      </p>
      <div class="cc-share-actions">
        <button type="button" class="cc-button cc-share-copy" data-busy={copy() === 'copying' ? 'true' : undefined} onClick={() => void copyLink()}>
          <LinkGlyph /><span>{copy() === 'copied' ? 'Link copied' : 'Copy the link'}</span>
        </button>
        <a class="cc-share-open" href={props.links.imageUrl} target="_blank" rel="noopener">Open the picture</a>
      </div>
      <p class="cc-share-status" role="status" aria-live="polite">
        <Switch>
          <Match when={copy() === 'copied'}>The card’s link is on your clipboard.</Match>
          <Match when={copy() === 'failed'}>Copying was not allowed here. Select the link below and copy it yourself.</Match>
        </Switch>
      </p>
      <Show when={copy() === 'failed'}>
        <label class="cc-share-field"><span class="cc-share-hidden">The card’s link</span>
          <input ref={element => (field = element)} readonly value={page()} onFocus={event => event.currentTarget.select()} />
        </label>
      </Show>
    </div>
  </aside>;
}

function LinkGlyph(): JSX.Element {
  return <svg class="cc-share-glyph" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8.4 11.6a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1.1 1.1" />
    <path d="M11.6 8.4a3.2 3.2 0 0 0-4.5 0L4.5 11a3.2 3.2 0 0 0 4.5 4.5l1.1-1.1" />
  </svg>;
}
