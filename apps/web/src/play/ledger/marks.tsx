import type { JSX } from 'solid-js';

/**
 * The ledger's marks, drawn in the kit's one family: inked lines with a round nib, sized to a 24 unit grid, coloured
 * by the surface they sit on (ink on parchment, cream on wood). No images, no emoji.
 */

const mark = (cls: string, body: JSX.Element, box = '0 0 24 24') =>
  <svg class={`pl-mark ${cls}`} viewBox={box} aria-hidden="true">{body}</svg>;

/** An open door in a round-topped frame: back out into the street. */
export const doorMark = () => mark('pl-mark-door', <>
  <path d="M5.5 21V9.5a6.5 6.5 0 0 1 13 0V21" />
  <path d="M8.5 21V10.6a3.5 3.5 0 0 1 2.2-3.2L15.5 5.6V21" class="pl-mark-fill" />
  <path d="M3.5 21h17" /><circle cx="13.4" cy="14" r=".6" class="pl-mark-dot" />
</>);

/** A bound ledger, slightly open, with its ribbon: the touch button. */
export const bookMark = () => mark('pl-mark-book', <>
  <path d="M12 6.5C9.8 5 6.6 4.6 3.5 5.2v13c3.1-.6 6.3-.2 8.5 1.3 2.2-1.5 5.4-1.9 8.5-1.3v-13c-3.1-.6-6.3-.2-8.5 1.3Z" />
  <path d="M12 6.5v13" /><path d="M6 8.6c1.6-.2 3 0 4 .4M6 11.4c1.6-.2 3 0 4 .4M14 9c1-.4 2.4-.6 4-.4" class="pl-mark-faint" />
  <path d="M15.5 4.6v7.2l1.4-1.2 1.4 1.2V4.4" class="pl-mark-fill" />
</>);

/** A mouse seen from above, its left button inked in. */
export const mouseMark = () => mark('pl-mark-mouse', <>
  <rect x="6.5" y="3.5" width="11" height="17" rx="5.5" /><path d="M12 3.5v6.2M6.5 9.7h11" />
  <path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v.7H12Z" class="pl-mark-fill" />
</>);

/** An arrow leaving through a frame: this entry opens another panel and closes the ledger. */
export const awayMark = () => mark('pl-mark-away', <>
  <path d="M10 5.5H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 19.5h11a1.5 1.5 0 0 0 1.5-1.5v-4" />
  <path d="M13 4.5h6.5V11M19.2 4.8 11 13" />
</>);

/** The anvil, for the Forge entry. */
export const anvilMark = () => mark('pl-mark-anvil', <>
  <path d="M3.5 8.5h13.5c0 2.6-2.1 4.2-4.6 4.4v2.6l2.6 2.5v1.5H6.5V18l2.6-2.5v-2.6C6.3 12.7 3.5 11 3.5 8.5Z" />
  <path d="M17 8.5h3.5l-1 1.8H17" /><path d="M8 5.2l1.3-1.7M12 4.6V2.5M15.6 5.2l-1.3-1.7" class="pl-mark-faint" />
</>);

/** The hearth with its flame: you are home. */
export const hearthMark = () => mark('pl-mark-hearth', <>
  <path d="M4.5 20.5v-8.2L12 5.5l7.5 6.8v8.2" /><path d="M2.8 13.8 12 5.5l9.2 8.3M3 20.5h18" />
  <path d="M12 19.3c-1.9 0-2.9-1.2-2.9-2.6 0-1.7 1.6-2.4 1.9-4.4 1.3.8 1.6 2 1.4 2.9.7-.3 1.2-.8 1.3-1.5.8.8 1.2 1.9 1.2 3 0 1.5-1 2.6-2.9 2.6Z" class="pl-mark-fill" />
</>);

/** The ink flourish under a heading: a nib stroke that swells, a lozenge, and its mirror. */
export const flourish = () => <svg class="pl-flourish" viewBox="0 0 220 14" aria-hidden="true" preserveAspectRatio="none">
  <path d="M2 7c30 0 58-3.2 86-3.2 6 0 10 1.6 14 3.2-4 1.6-8 3.2-14 3.2C60 10.2 32 7 2 7Z" />
  <path d="M218 7c-30 0-58-3.2-86-3.2-6 0-10 1.6-14 3.2 4 1.6 8 3.2 14 3.2 28 0 56-3.2 86-3.2Z" />
  <path d="M110 2.4 114.6 7 110 11.6 105.4 7Z" />
</svg>;

/** A brass corner cap with two pins, drawn for the top-left; the others are this one turned. */
export const cornerCap = () => <svg class="pl-corner-cap" viewBox="0 0 44 44" aria-hidden="true">
  <path class="pl-cap-plate" d="M2 2h40c-3 4-9 6-16 6-9 0-14 5-14 13 0 8-3 15-10 21Z" />
  <path class="pl-cap-shine" d="M5 5h28M5 5v24" />
  <circle class="pl-cap-pin" cx="9" cy="9" r="2.3" /><circle class="pl-cap-pin" cx="25" cy="6.4" r="1.6" /><circle class="pl-cap-pin" cx="6.4" cy="25" r="1.6" />
</svg>;

/** A mallet crossed over a chisel: the build rack. */
export const buildMark = () => mark('pl-mark-build', <>
  <path d="M4.2 7.4 8.6 3l3.6 3.6-4.4 4.4Z" class="pl-mark-fill" /><path d="m10.4 8.8 9.4 9.4a1.5 1.5 0 0 1-2.1 2.1L8.3 10.9" />
  <path d="m19.6 4.4-8.9 8.9M17.6 2.4l4 4-2 2-4-4Z" /><path d="m10.7 13.3-3.5 4.2-1.9.6.6-1.9 4.2-3.5" class="pl-mark-fill" />
</>);

/** A signpost at a fork: the way home, before there is a home to point to. */
export const signpostMark = () => mark('pl-mark-signpost', <>
  <path d="M11.5 21.5V2.5M8 21.5h7" /><path d="M11.5 5h7.5l2 2.2-2 2.2h-7.5Z" class="pl-mark-fill" /><path d="M11.5 11.5H4.5l-2 2.2 2 2.2h7" class="pl-mark-fill" />
</>);
