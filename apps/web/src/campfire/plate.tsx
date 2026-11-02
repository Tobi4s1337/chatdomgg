import { Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import type { CampfireFrame, DuskCourtPlayerView } from '@chatdom/shared';
import { clockText, phaseWords } from './copy';
import type { CampfireSession, CampfireSessionState } from './session';

/* What every fire surface shares: the session as a signal, the room's clock, and the public phase plate. */

export function useSessionState(session: CampfireSession): () => CampfireSessionState {
  const [state, setState] = createSignal(session.current(), { equals: false });
  onCleanup(session.subscribe(setState));
  return state;
}

/** The room's clock, ticking for the plate. */
export function useRoomClock(now: () => number, everyMs = 250): () => number {
  const [time, setTime] = createSignal(now());
  const id = setInterval(() => setTime(now()), everyMs);
  onCleanup(() => clearInterval(id));
  return time;
}

export function PhasePlate(props: { frame: CampfireFrame | null; now: number; compact?: boolean; children?: JSX.Element }) {
  const words = createMemo(() => phaseWords(props.frame));
  const remaining = () => {
    const court = props.frame?.court;
    if (!court || court.phase === 'ended' || court.waiting) return null;
    return court.deadline - props.now;
  };
  return <section class="campfire-plate cd-plate" classList={{ 'is-compact': !!props.compact }} aria-live="polite">
    <p class="campfire-plate-eyebrow cd-label">{words().eyebrow}</p>
    <div class="campfire-plate-title">
      <h2>{words().title}</h2>
      <Show when={remaining() !== null}><span class="campfire-clock cd-slip" role="timer" aria-label="Time left in this phase">{clockText(remaining()!)}</span></Show>
    </div>
    <Show when={words().line}><p class="campfire-plate-line">{words().line}</p></Show>
    {props.children}
  </section>;
}

export const lanternGlyph = (player: DuskCourtPlayerView): 'lantern' | 'lantern-out' => player.lantern === 'lit' && !player.gone ? 'lantern' : 'lantern-out';
