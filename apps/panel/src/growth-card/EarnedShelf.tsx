import { For, Show, type JSX } from 'solid-js';
import { CrestArms } from '../../../../packages/ui/src/passport/Arms';
import type { ShelfState } from './shelf';
import '../../../../packages/ui/src/kit.css';
import './shelf.css';

export function EarnedShelf(props: { state: ShelfState; onOpenPassport?: () => void }): JSX.Element {
  return <section class="gcs-shelf" aria-label="Earned keepsakes">
    <p class="gcs-label">Keepsakes from the road</p>
    <Show when={props.state.origin === 'simulated'}><p class="gcs-simulated">SIMULATED</p></Show>
    <Show when={props.state.kind === 'ready' ? props.state : undefined} fallback={<p class="gcs-message" role="status">{props.state.kind === 'loading' ? 'Gathering keepsakes…' : props.state.kind === 'hidden' ? 'Travels kept private.' : props.state.kind === 'empty' ? 'No keepsakes recorded yet.' : props.state.kind === 'invalid' ? 'Keepsakes could not be verified.' : 'Keepsakes are unavailable.'}</p>}>
      {ready => <><ul><For each={ready().items}>{item => <li><CrestArms crest={item.kingdom.crest} kingdomName={item.kingdom.name} size={28} decorative /><span><strong>{item.name}</strong><small>From <bdi>{item.kingdom.name}</bdi></small></span></li>}</For></ul><Show when={ready().hasMore}><Show when={props.onOpenPassport} fallback={<p class="gcs-more">More keepsakes in the passport.</p>}>{open => <button class="gcs-open" type="button" onClick={() => open()()}>See more in the passport</button>}</Show></Show></>}
    </Show>
  </section>;
}
