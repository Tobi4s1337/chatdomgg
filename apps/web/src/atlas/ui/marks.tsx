import { onMount } from 'solid-js';
import stampSheetUrl from '../assets/stamps.webp?url';
import stampSheet from '../assets/stamps.json';
import { drawShield, shieldDesign, SHIELD_ASPECT } from '../heraldry';
import type { Stamp } from '../map/paint';

const sheet = stampSheet as { width: number; height: number; stamps: (Stamp & { name: string })[] };

/** A stamp from the sheet, drawn as a CSS sprite at `width` CSS px (the sheet is stored at twice density). */
export function StampIcon(props: { group: string; index?: number; width: number; class?: string }) {
  const stamps = sheet.stamps.filter((stamp) => stamp.group === props.group);
  const stamp = stamps[(props.index ?? 0) % Math.max(1, stamps.length)];
  if (!stamp) return null;
  const k = props.width / stamp.ink.w;
  const layer = (frame: { x: number; y: number }) => `url(${stampSheetUrl}) ${-frame.x * k}px ${-frame.y * k}px / ${sheet.width * k}px ${sheet.height * k}px no-repeat`;
  return (
    <span class={`atlas-stamp ${props.class ?? ''}`} aria-hidden="true" style={{ width: `${props.width}px`, height: `${stamp.ink.h * k}px` }}>
      {stamp.fill && <span class="atlas-stamp-fill" style={{ '-webkit-mask': layer(stamp.fill), mask: layer(stamp.fill) }} />}
      <span class="atlas-stamp-ink" style={{ background: layer(stamp.ink) }} />
    </span>
  );
}

/** A channel's seeded arms on a small canvas. */
export function ShieldIcon(props: { channelId: string; width: number; label?: string }) {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const pad = 4;
    if (!canvas) return;
    canvas.width = Math.ceil((props.width + pad * 2) * ratio);
    canvas.height = Math.ceil((props.width * SHIELD_ASPECT + pad * 2) * ratio);
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    drawShield(ctx, shieldDesign(props.channelId), pad, pad, props.width, { pixelRatio: ratio });
  });
  return (
    <canvas
      ref={(element) => (canvas = element)}
      class="atlas-shield"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
      style={{ width: `${props.width + 8}px`, height: `${props.width * SHIELD_ASPECT + 8}px` }}
    />
  );
}
