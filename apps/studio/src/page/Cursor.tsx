// The mouse cursor, drawn by the page: Windows 11's default arrow and hand at 100 % scaling, as crisp vectors so they
// stay sharp when the recorder renders at device scale 2 and when the virtual camera zooms in.
import { Show, type JSX } from 'solid-js';
import type { Cursor as CursorState } from '../types';

// Both shapes are drawn with their hotspot at (0, 0): the arrow's tip and the hand's index fingertip.
const ARROW = 'M0.5 0.5V17.1L4.6 13.2L7.3 19.5L10 18.4L7.4 12.2H13.1Z';
const HAND = 'M0 0C1.1 0 2 .9 2 2V8.2C2.3 8.1 2.6 8 3 8 3.9 8 4.6 8.5 4.9 9.3 5.2 9.1 5.6 9 6 9 6.9 9 7.6 9.6 7.9 10.4 8.2 10.3 8.5 10.2 8.8 10.2 9.9 10.2 10.7 11.1 10.7 12.2V16C10.7 19.3 8.2 22 4.9 22H3.1C1.1 22-.3 21.1-1.4 19.6L-5.2 14.3C-5.8 13.5-5.6 12.4-4.8 11.9-4.1 11.4-3.1 11.6-2.5 12.3L-2 12.9V2C-2 .9-1.1 0 0 0Z';
const HAND_LINES = 'M2 8.2V13M4.9 9.3V13M7.9 10.4V13';

export function Cursor(props: { cursor: CursorState }): JSX.Element {
  const c = () => props.cursor;
  // A press dips the cursor slightly toward its hotspot, as the eye reads a click.
  const transform = () => `translate(${c().x}px, ${c().y}px) scale(${1 - 0.1 * Math.min(1, Math.max(0, c().pressed))})`;
  return (
    <Show when={c().visible}>
      <div class="cursor" style={{ transform: transform() }}>
        <Show when={c().shape === 'hand'} fallback={
          <svg class="cursor__svg" viewBox="-1 -1 16 22" width="16" height="22" style={{ left: '-1px', top: '-1px' }}>
            <path d={ARROW} fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="round" />
          </svg>
        }>
          <svg class="cursor__svg" viewBox="-7 -1 19 24" width="19" height="24" style={{ left: '-7px', top: '-1px' }}>
            <path d={HAND} fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="round" />
            <path d={HAND_LINES} fill="none" stroke="#000" stroke-width="0.9" stroke-linecap="round" />
          </svg>
        </Show>
      </div>
    </Show>
  );
}
