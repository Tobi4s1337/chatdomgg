import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { portraitUrl, type ChannelPortrait } from '../data/portrait';
import { ShieldIcon } from './marks';
import './face.css';

/** A channel's picture pressed into the Atlas, with its own arms while the picture is unavailable. */
export function ChannelFaceSeal(props: {
  channelId: string;
  name?: string | null | undefined;
  portrait?: ChannelPortrait | null | undefined;
  compact?: boolean | undefined;
}) {
  const [candidate, setCandidate] = createSignal<{ url: string; channelId: string } | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  createEffect(() => {
    const channelId = props.channelId;
    const portrait = props.portrait;
    const url = portraitUrl(portrait);
    setLoaded(false);
    const current = url ? { url, channelId } : null;
    setCandidate(current);
    if (!current || !portrait) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expire = () => {
      const remaining = portrait.freshUntil - Date.now();
      if (remaining <= 0) {
        if (candidate() === current) {
          setLoaded(false);
          setCandidate(null);
        }
      } else {
        timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      }
    };
    expire();
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <span class="atlas-face-seal" data-atlas-face={loaded() ? 'picture' : 'shield'} data-atlas-face-size={props.compact ? 'compact' : 'card'}>
      <span class="atlas-face-well">
        <span class="atlas-face-arms" aria-hidden="true">
          <Show when={props.channelId} keyed>{(id) => <ShieldIcon channelId={id} width={props.compact ? 15 : 31} />}</Show>
        </span>
        <Show when={candidate()} keyed>
          {(image) => (
            <img
              class="atlas-face-picture"
              classList={{ 'atlas-face-picture-ready': loaded() }}
              src={image.url}
              referrerpolicy="no-referrer"
              decoding="async"
              alt={props.name ? `${props.name}'s Twitch picture` : 'Twitch picture'}
              on:load={() => {
                if (candidate() === image && portraitUrl(props.portrait) === image.url && props.channelId === image.channelId) setLoaded(true);
              }}
              on:error={() => {
                if (candidate() === image) {
                  setLoaded(false);
                  setCandidate(null);
                }
              }}
            />
          )}
        </Show>
      </span>
    </span>
  );
}
