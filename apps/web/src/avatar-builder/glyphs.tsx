import type { JSX } from 'solid-js';
import type { TabGlyph } from './catalogue';

/*
 * The builder's engraved marks: one family, drawn for the wardrobe on a 20-unit grid with a 1.6 stroke and round
 * ends, coloured by the fitting they sit on (brass on wood, ink on parchment).
 */

const mark = (children: JSX.Element, cls = 'ab-glyph') =>
  <svg class={cls} viewBox="0 0 20 20" aria-hidden="true">{children}</svg>;

const TABS: Readonly<Record<TabGlyph, () => JSX.Element>> = {
  face: () => mark(<><circle cx="10" cy="10" r="6.6" /><path d="M7.6 9.2v.6M12.4 9.2v.6M7.4 12.4c1.5 1.3 3.7 1.3 5.2 0" /></>),
  hair: () => mark(<><path d="M3.5 8.5c1.8-3.6 4-5 6.5-5s4.7 1.4 6.5 5" /><path d="M3.5 8.5h13" /><path d="M5.5 8.5v6M8 8.5v8M10.5 8.5v7M13 8.5v8M15.3 8.5v6" /></>),
  beard: () => mark(<><path d="M4.4 7.6c0 6 2.4 9.2 5.6 9.2s5.6-3.2 5.6-9.2" /><path d="M6.6 9.6c1.6 1 5.2 1 6.8 0M8 13.2h4" /></>),
  hat: () => mark(<><path d="M3 14.6h14" /><path d="M5.2 14.6c.4-3 1-4.6 2-5.4L10 3.4l2.8 5.8c1 .8 1.6 2.4 2 5.4" /><path d="M6.6 11.6h6.8" /></>),
  trinkets: () => mark(<><circle cx="6.3" cy="11" r="3.1" /><circle cx="13.7" cy="11" r="3.1" /><path d="M9.4 10.6c.4-.5 .8-.5 1.2 0M3.2 10.4 2 8.6M16.8 10.4 18 8.6" /></>),
  top: () => mark(<path d="M7.2 3.4 3 5.8l1.6 3.6 1.8-.8V16.6h7.2V8.6l1.8.8L17 5.8l-4.2-2.4c-.6 1.3-1.6 2-2.8 2s-2.2-.7-2.8-2Z" />),
  layer: () => mark(<><path d="M7 3.4 3.2 5.6l.6 11h12.4l.6-11L13 3.4" /><path d="M7 3.4 10 9.6l3-6.2M10 9.6v7M7.4 12.4h.01M12.6 12.4h.01" /></>),
  below: () => mark(<path d="M7 2.8v8.6c0 .9-.6 1.6-1.4 2l-1.6.8c-.8.4-1 1-1 1.8v1.4h11.8c.6 0 1-.4 1-1v-.2c0-1-.8-1.8-1.8-1.8h-2.2c-.8 0-1.4-.6-1.4-1.4V2.8Z" />),
  carry: () => mark(<><ellipse cx="10.4" cy="6.8" rx="4.2" ry="4.8" /><path d="m9.6 11.5.8 1 .8-1M10.4 12.5c-1.4 1.6 1 2.6-.4 4.6" /><path d="M8.6 5c.4-.9 1-1.4 1.8-1.6" /></>),
  earned: () => mark(<><circle cx="10" cy="7.6" r="4.4" /><path d="m7.4 11.2-1.8 5.6 2.6-1 1.6 2 .2-6M12.6 11.2l1.8 5.6-2.6-1-1.6 2" /><path d="m10 5.4.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2Z" /></>),
  yours: () => mark(<><path d="M3 6.6h10.4c1.6 0 3.2-.6 4.2-1.6v3.2c-1 1-2.4 1.6-4 1.6h-.4l-.6 2.8h-5.2l-.6-2.8H5c-1 0-2-1-2-2Z" /><path d="M7 12.6v2.2H5.4v1.8h9.2v-1.8H13v-2.2" /></>),
};

export const tabGlyph = (id: TabGlyph): JSX.Element => TABS[id]();

export const closeGlyph = () => mark(<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />);
export const closerGlyph = () => mark(<><circle cx="8.6" cy="8.6" r="5" /><path d="m12.4 12.4 4.6 4.6M6.6 8.6h4M8.6 6.6v4" /></>);
export const wholeGlyph = () => mark(<><circle cx="8.6" cy="8.6" r="5" /><path d="m12.4 12.4 4.6 4.6M6.6 8.6h4" /></>);
export const undoGlyph = () => mark(<path d="M7.5 5 3.5 9l4 4M4 9h7.5a5 5 0 0 1 0 10H9" />);
export const redoGlyph = () => mark(<path d="m12.5 5 4 4-4 4M16 9H8.5a5 5 0 0 0 0 10H11" />);
export const diceGlyph = () => mark(<><rect x="3" y="3" width="14" height="14" rx="2.5" /><circle class="ab-glyph-fill" cx="7" cy="7" r=".9" /><circle class="ab-glyph-fill" cx="13" cy="13" r=".9" /><circle class="ab-glyph-fill" cx="10" cy="10" r=".9" /><circle class="ab-glyph-fill" cx="13" cy="7" r=".9" /><circle class="ab-glyph-fill" cx="7" cy="13" r=".9" /></>);
export const resetGlyph = () => mark(<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1M4.2 3.6v3h3" />);
export const lockGlyph = () => mark(<><path d="M6 9V7a4 4 0 0 1 8 0v2" /><rect x="4.5" y="9" width="11" height="8" rx="1.5" /></>, 'ab-glyph ab-lock-glyph');
export const turnGlyph = () => mark(<><path d="M3.4 11.4c1.4 2.4 3.8 3.8 6.6 3.8s5.2-1.4 6.6-3.8" /><path d="m14.2 10.2 2.4 1.2-.4 2.6M5.8 10.2l-2.4 1.2.4 2.6" /></>);
export const mirrorGlyph = () => mark(<><ellipse cx="10" cy="8.4" rx="4.6" ry="5.8" /><path d="M10 14.2v3.2M7.2 17.4h5.6M8.2 5.6c-.8.8-1.2 1.8-1.2 3" /></>);
