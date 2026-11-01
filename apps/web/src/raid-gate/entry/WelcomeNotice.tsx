import { Show } from 'solid-js';
import type { RaidWelcomeStatus } from './adapter';
import './entry.css';

/** The same invitation and arrival notices used by the live entry and the private presentation bench. */
export default function WelcomeNotice(props: { status: RaidWelcomeStatus | undefined; enterOrdinarily: () => void }) {
  return <>
    <Show when={props.status?.kind === 'choice'}>
      <section class="raid-entry-choice" aria-label="Raid invitation">
        <div class="raid-entry-choice-board"><div class="raid-entry-choice-paper">
          <p class="raid-entry-eyebrow">At the kingdom gate</p><h1>Your visit is still welcome.</h1>
          <p>{props.status?.message}</p><button type="button" onClick={props.enterOrdinarily}>Enter without the raid</button>
          <a href="/map">Return to the Atlas</a>
        </div></div>
      </section>
    </Show>
    <Show when={props.status?.kind === 'confirmed' || props.status?.kind === 'unavailable' || props.status?.kind === 'pending'}>
      <aside class="raid-entry-welcome" role="status" aria-live="polite">
        <span class="raid-entry-pin" aria-hidden="true" />
        <p>{props.status?.message}</p>
        <Show when={props.status?.kind === 'confirmed' ? props.status : undefined}>{welcome =>
          <a href={welcome().watchUrl} target="_blank" rel="noopener noreferrer">Watch on Twitch <span aria-hidden="true">↗</span></a>}
        </Show>
      </aside>
    </Show>
  </>;
}
