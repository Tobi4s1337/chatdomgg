import { onCleanup, Show, type Accessor } from 'solid-js';
import { anvilHomeLine, anvilLine, type AnvilHome, type AnvilState } from './anvil-state';
import { openForge, type ForgeHandle, type ForgeHost } from '../../forge/play';

/** The chat line a wish starts from. The Forge reads chat; the anvil only shows what it hears. */
export const FORGE_EXAMPLE = '!forge a chimney shaped like a sleeping dragon';

/**
 * The visit card beside the hero anvil: the fire's actual state, how a wish is made (in chat), where it lands and
 * the way back. A carved parchment plate on dark wood, like the prompt it replaced; never a dashboard.
 */
export function AnvilVisit(props: {
  readonly state: Accessor<AnvilState>;
  readonly home: Accessor<AnvilHome>;
  readonly coarse: boolean;
  readonly onLeave: () => void;
  /** Play supplies its HUD node and pointer ownership; the anvil never invents a walk host. */
  readonly forgeHost?: ForgeHost;
}) {
  let wish: ForgeHandle | undefined;
  onCleanup(() => wish?.dispose());
  const openWish = () => {
    if (!props.forgeHost || wish?.isOpen()) return;
    wish = openForge(props.forgeHost, 'anvil');
  };
  const tone = () => props.state().heard === 'unavailable' ? 'cold' : props.state().working || props.state().landed ? 'working' : props.state().heard === 'listening' ? 'awake' : 'waiting';
  const pieces = () => props.state().standing;
  return (
    <section class="ix-anvil" role="dialog" aria-label="At the anvil" data-tone={tone()}>
      <div class="ix-anvil-plate">
        <p class="ix-anvil-eyebrow">The anvil</p>
        <h2 class="ix-anvil-title">Give the smith a wish.</h2>
        <p class="ix-anvil-fire" aria-live="polite"><i class="ix-anvil-ember" aria-hidden="true" /><span>{anvilLine(props.state())}</span></p>
        <div class="ix-anvil-how">
          <Show when={props.forgeHost}><button type="button" class="ix-anvil-leave" onClick={openWish}>Make a wish</button></Show>
          <p class="ix-anvil-step">Write it in Twitch chat:</p>
          <p class="ix-anvil-chalk"><code>{FORGE_EXAMPLE}</code></p>
          <Show when={anvilHomeLine(props.home())}>{line => <p class="ix-anvil-step">{line()}</p>}</Show>
          <p class="ix-anvil-note">The fire checks your home and your coals when your words arrive. Nothing is spent here.</p>
        </div>
        <Show when={pieces() > 0}>
          <p class="ix-anvil-made">
            {pieces() === 1 ? 'One piece made at this anvil stands in the kingdom.' : `${pieces()} pieces made at this anvil stand in the kingdom.`}
            <Show when={props.state().latest}>{latest => <> Most recently for {latest().maker}.</>}</Show>
          </p>
        </Show>
        <button type="button" class="ix-anvil-leave" onClick={() => props.onLeave()}>
          <Show when={!props.coarse}><span class="ix-anvil-key" aria-hidden="true">Esc</span></Show>
          <span>Back to the street</span>
        </button>
      </div>
    </section>
  );
}
