import { createEffect } from 'solid-js';
import { blazon, drawShield, SHIELD_ASPECT, shieldDesign } from '../atlas/heraldry';

/**
 * A kingdom's arms pressed into a wax seal: the Atlas's own shield for this channel ID (so the gate and the map
 * show the same arms), inked onto a canvas and set in a disc of wax drawn in SVG.
 */
export function Seal(props: { kingdomId: string; size: number; wax?: 'crimson' | 'umber'; label?: string }) {
  let canvas!: HTMLCanvasElement;
  const draw = () => {
    const design = shieldDesign(props.kingdomId);
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const width = props.size * 0.46, height = width * SHIELD_ASPECT;
    canvas.width = Math.ceil(width * ratio) + 4; canvas.height = Math.ceil(height * ratio) + 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShield(ctx, design, 2 / ratio, 2 / ratio, width, { pixelRatio: ratio });
  };
  createEffect(() => { void props.kingdomId; void props.size; draw(); });
  return <span class={`rg-seal rg-seal-${props.wax ?? 'crimson'}`} style={{ '--seal': `${props.size}px` }} role="img" aria-label={props.label ? `${props.label}: ${blazon(shieldDesign(props.kingdomId))}` : undefined} aria-hidden={props.label ? undefined : 'true'}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path class="rg-wax" d="M50 3c6 0 8 4 13 4.5s8.6-2 13 1.6 2.6 8.3 6 12 9 3.4 10.6 8.6-2.6 8-1.8 13.1 5.5 7.4 4 12.6-6.7 6.3-8.2 11.3 1 9.5-3 13.2-8.7.8-13.3 3.3-5.7 8-11 8.8-7.6-3.5-12.8-3.5-8 4.2-13 2.6-5.2-6.6-9.8-9.3-9.7-1-12.1-5.8 1.5-9-.4-13.8-6.9-6.5-6.4-11.8 5-7.4 5.5-12.7-3.4-8.6.3-12.5 9-2.4 12.6-6.1 3.4-9 8.4-11S44 3 50 3Z" />
      <circle class="rg-wax-ring" cx="50" cy="50" r="36" />
      <circle class="rg-wax-ring rg-wax-ring-inner" cx="50" cy="50" r="32.5" />
    </svg>
    <canvas ref={element => { canvas = element; }} />
  </span>;
}
