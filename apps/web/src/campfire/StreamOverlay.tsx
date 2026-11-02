import { For, Show } from 'solid-js';
import { GALLERY_WORDS, ROLE_NAMES } from './copy';
import { Glyph } from './glyphs';
import { PhasePlate, lanternGlyph, useRoomClock, useSessionState } from './plate';
import type { CampfireSession } from './session';

/*
 * The fire on stream: a small, quiet plate with the phase and its clock, and the circle's lanterns. It reads only the
 * public frame; it is given a session opened with `private: false`, so no card or tap ever reaches it. With no round
 * running it shows nothing at all and leaves the picture to the fire.
 */
export function StreamOverlay(props: { session: CampfireSession }) {
  const state = useSessionState(props.session);
  const now = useRoomClock(() => props.session.now(), 500);
  const frame = () => state().frame, court = () => frame()?.court ?? null;
  return <div class="campfire-stream cd-kit" data-campfire-stream>
    <Show when={court()}>
      <PhasePlate frame={frame()} now={now()} compact />
      <ol class="campfire-stream-circle" aria-label="The circle">
        <For each={court()!.players}>{player => <li classList={{ 'is-dark': player.lantern !== 'lit' || player.gone }}>
          <Glyph name={lanternGlyph(player)} />
          <span>{player.name}</span>
          <Show when={player.role}><span class="cd-label">{ROLE_NAMES[player.role!]}</span></Show>
          <Show when={player.embers > 0 && !player.gone}><span class="campfire-chip-embers"><For each={Array.from({ length: player.embers })}>{() => <Glyph name="ember" />}</For></span></Show>
        </li>}</For>
      </ol>
      <Show when={frame()!.live && (court()!.phase === 'talk' || court()!.phase === 'ballot')}><p class="campfire-stream-gallery cd-slip">{GALLERY_WORDS}</p></Show>
    </Show>
  </div>;
}
