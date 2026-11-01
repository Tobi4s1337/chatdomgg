import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { openRoadAtlas, smoothstep, type RoadAtlas } from '../atlas/road';

/** A raider arriving rides in along the real road at most this long; the kingdom loads beneath it meanwhile. */
const RIDE_CAP_S = 9;
const RISE_S = .9, WAKE_S = 1.1;

/**
 * A raider's way in (Atlas.md §7.5): they start on the raiding channel's land on the Atlas and ride the road to this
 * holding with the raid's public column, so even someone new first sees where their community came from. The road
 * and the column are the Atlas's own; the count is the raid's public viewer count, never a crowd of people.
 */
export function RaidRide(props: { from: string; to: string; viewers: number; signal: AbortSignal; onArrived: () => void; onUnavailable: () => void }) {
  let host: HTMLDivElement | undefined;
  let map: RoadAtlas | null = null;
  let frame = 0;
  const [caption, setCaption] = createSignal<string | null>(null);
  onCleanup(() => { cancelAnimationFrame(frame); map?.dispose(); });
  onMount(() => {
    if (!host) return;
    void openRoadAtlas(host, { from: props.from, to: props.to, viewers: props.viewers, signal: props.signal,
      reduceMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }).then(async opened => {
      if (props.signal.aborted) { opened.dispose(); return; }
      map = opened;
      setCaption(`The raid from ${opened.from.name} rides to ${opened.to.name}`);
      await opened.ready;
      const ride = Math.min(RIDE_CAP_S, opened.rideSeconds);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        const rise = smoothstep(0, RISE_S, t), travel = smoothstep(RISE_S, RISE_S + ride, t);
        const wake = smoothstep(RISE_S + ride, RISE_S + ride + WAKE_S, t);
        opened.show({ rise, travel, file: wake, wake, time: t, marching: travel > 0 && wake < 1 });
        if (wake >= 1) { props.onArrived(); return; }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, () => { if (!props.signal.aborted) props.onUnavailable(); });
  });
  return <div class="raid-ride" ref={element => (host = element)}>
    <Show when={caption()}>{text => <p class="raid-ride-caption">{text()}</p>}</Show>
  </div>;
}
