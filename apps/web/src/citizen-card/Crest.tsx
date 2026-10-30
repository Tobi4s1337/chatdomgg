import { onMount } from 'solid-js';
import { SHIELD_ASPECT, blazon, drawShield, shieldDesign, shieldPath } from '../atlas/heraldry';

const ratio = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));

/** The kingdom's arms, inked and washed onto the parchment exactly as the Atlas draws them. */
export function PaintedCrest(props: { kingdomId: string; kingdomName: string; width: number }) {
  let canvas: HTMLCanvasElement | undefined;
  const pad = 5;
  onMount(() => {
    if (!canvas) return;
    const r = ratio();
    canvas.width = Math.ceil((props.width + pad * 2) * r);
    canvas.height = Math.ceil((props.width * SHIELD_ASPECT + pad * 2) * r);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(r, r);
    drawShield(ctx, shieldDesign(props.kingdomId), pad, pad, props.width, { pixelRatio: r, halo: { color: '#f6ecd3', width: 3 } });
  });
  return <canvas ref={element => (canvas = element)} class="cc-crest" role="img"
    aria-label={`Arms of ${props.kingdomName}: ${blazon(shieldDesign(props.kingdomId))}`}
    style={{ width: `${props.width + pad * 2}px`, height: `${props.width * SHIELD_ASPECT + pad * 2}px` }} />;
}

/**
 * A wax seal pressed with the kingdom's crest. The wax is drawn in code: an uneven poured disc, a pressed ring,
 * and the arms impressed as relief (their tinctures read only as tone in the wax).
 */
export function WaxSeal(props: { kingdomId: string; size: number }) {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    if (!canvas) return;
    const r = ratio(), s = props.size;
    canvas.width = Math.ceil(s * r); canvas.height = Math.ceil(s * r);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(r, r);
    const c = s / 2;
    // Poured edge: a disc whose radius wanders a little, seeded by the kingdom so every seal keeps its shape.
    const seed = [...props.kingdomId].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const wobble = Math.sin(a * 5 + seed % 7) * .025 + Math.sin(a * 11 + seed % 13) * .018 + Math.sin(a * 3 + seed % 5) * .02;
      const radius = c * (.94 + wobble);
      const x = c + Math.cos(a) * radius, y = c + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const wax = ctx.createRadialGradient(c * .7, c * .62, c * .1, c, c, c);
    wax.addColorStop(0, '#c4473a'); wax.addColorStop(.55, '#9b2a22'); wax.addColorStop(1, '#6a1914');
    ctx.save();
    ctx.shadowColor = 'rgba(30, 10, 6, .55)'; ctx.shadowBlur = s * .06; ctx.shadowOffsetY = s * .03;
    ctx.fillStyle = wax; ctx.fill();
    ctx.restore();
    // The pressed ring of the matrix.
    const ring = (radius: number, width: number, colour: string, dy: number) => {
      ctx.beginPath(); ctx.arc(c, c + dy, radius, 0, Math.PI * 2);
      ctx.lineWidth = width; ctx.strokeStyle = colour; ctx.stroke();
    };
    ring(c * .74, s * .03, 'rgba(255, 170, 140, .28)', s * .008);
    ring(c * .74, s * .03, 'rgba(60, 8, 6, .55)', -s * .008);
    // The arms, as relief: their light and shade only.
    const shieldWidth = s * .42, x = c - shieldWidth / 2, y = c - shieldWidth * SHIELD_ASPECT / 2 + s * .01;
    const relief = document.createElement('canvas');
    relief.width = canvas.width; relief.height = canvas.height;
    const rctx = relief.getContext('2d');
    if (rctx) {
      rctx.scale(r, r);
      drawShield(rctx, shieldDesign(props.kingdomId), x, y, shieldWidth, { pixelRatio: r, texture: false, ink: '#000' });
      ctx.save();
      ctx.globalAlpha = .55;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.filter = 'grayscale(1) contrast(1.3)';
      ctx.drawImage(relief, 0, 0, s, s);
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath(); shieldPath(ctx, x, y, shieldWidth);
    ctx.lineWidth = Math.max(1, s * .018);
    ctx.translate(0, s * .008); ctx.strokeStyle = 'rgba(255, 175, 150, .35)'; ctx.stroke();
    ctx.translate(0, -s * .016); ctx.strokeStyle = 'rgba(50, 6, 4, .6)'; ctx.stroke();
    ctx.restore();
    // A soft specular on the domed wax.
    const sheen = ctx.createRadialGradient(c * .62, c * .52, 0, c * .62, c * .52, c * .55);
    sheen.addColorStop(0, 'rgba(255, 220, 200, .32)'); sheen.addColorStop(1, 'rgba(255, 220, 200, 0)');
    ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(c, c, c * .9, 0, Math.PI * 2); ctx.fill();
  });
  return <canvas ref={element => (canvas = element)} class="cc-seal" aria-hidden="true" style={{ width: `${props.size}px`, height: `${props.size}px` }} />;
}
