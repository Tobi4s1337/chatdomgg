import type { JSX } from 'solid-js';
import type { BuildTool } from '@chatdom/shared';

/** Engraved marks, drawn for the rack on a 24-unit plate. Stroke colour follows the fitting. */
const mark = (children: JSX.Element) => <svg class="bt-mark" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

const cube = 'M4.5 12.5 12 9l7.5 3.5L12 16Zm0 0v6L12 22l7.5-3.5v-6M12 16v6';

export const toolMarks: Record<BuildTool, () => JSX.Element> = {
  place: () => mark(<><path d={cube} /><path d="M12 1.8v5.4M9.3 4.5h5.4" /></>),
  erase: () => mark(<><path d={cube} stroke-dasharray="1.6 2.1" /><path d="M9.3 4.5h5.4" /></>),
  paint: () => mark(<><path d="M20.6 3.4 14 10" /><path d="m12.4 8.6 3 3" /><path d="M12.6 9 7.4 14.1c-1.7 1.7-.6 3.6-2.9 5.6 3.1.5 6-.4 7.6-2l5.1-5.1" /><path d="M5.2 22h8" /></>),
  fill: () => mark(<><path d="m4.4 10.2 6.9-6.9 7.4 7.4-6.9 6.9Z" /><path d="m4.4 10.2 2.9 2.9M8.6 3.3l2.7 2.7" /><path d="M20.1 14.4c1.1 1.6 1.6 2.6 1.6 3.4a1.6 1.6 0 0 1-3.2 0c0-.8.5-1.8 1.6-3.4Z" /><path d="M2.6 21.6h12.2" /></>),
};

/** Brush sizes are drawn to scale against each other: 4, 2 and 1 build cells. */
export const brushMark = (cells: 1 | 2 | 4) => {
  const side = cells === 4 ? 13 : cells === 2 ? 7.5 : 3.6, at = 12 - side / 2;
  return mark(<><path class="bt-mark-faint" d="M3.5 3.5h17v17h-17Z" /><rect class="bt-mark-solid" x={at} y={at} width={side} height={side} rx=".7" /></>);
};

export const undoMark = () => mark(<path d="M8.5 4.5 3.8 9.2l4.7 4.7M4 9.2h10.2a5.6 5.6 0 0 1 0 11.2H10" />);
export const redoMark = () => mark(<path d="m15.5 4.5 4.7 4.7-4.7 4.7M20 9.2H9.8a5.6 5.6 0 0 0 0 11.2H14" />);
export const leaveMark = () => mark(<><path d="M4.5 21.5V9.8a5 5 0 0 1 10 0v11.7M2.5 21.5h14" /><path d="M11.8 14.6h9.4m-3-3 3 3-3 3" /></>);
/** A tray lid: open lifts the palette drawer, closed lowers it back into the rack. */
export const drawerMark = (open: boolean) => mark(<><path class="bt-mark-faint" d="M3.5 17.5h17v3h-17Z" /><path d={open ? 'm7.5 9.5 4.5 4.5 4.5-4.5' : 'm7.5 13.5 4.5-4.5 4.5 4.5'} /></>);
export const welcomeMark = () => mark(<><path d="m3 11.5 9-7.8 9 7.8M5.4 9.6v11.6h13.2V9.6" /><path d="M10 21.2v-5.4h4v5.4" /><path d="M12 11.2v.1" stroke-width="2.6" /></>);
