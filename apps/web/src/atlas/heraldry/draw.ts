/**
 * Draws a shield as an engraver would ink it and a painter would wash it: flat watercolour tinctures that pool
 * a little at their edges, a fine granulation once the shield is big enough to show it, and a crisp sepia outline.
 * No gloss, no glow: ink and watercolour can only darken paper.
 *
 * Works on a CanvasRenderingContext2D or an OffscreenCanvasRenderingContext2D (so inside a worker) and touches
 * nothing else of the environment.
 */
import { chargeShape } from './charges';
import { TINCTURES, type ShieldDesign, type Tincture } from './design';
import { chargeSpots, SHIELD_ASPECT, secondRegion, shieldOutline } from './geometry';
import { polygon, tracePath, type PathCommand, type PathPiece, type PathSink } from './path';

export type ShieldContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The Atlas's sepia ink. */
export const SHIELD_INK = '#3b2f25';
/** The parchment the map is drawn on. */
export const SHIELD_PAPER = '#efe3c6';

export interface ShieldHalo {
  /** Paper colour of the backing. Defaults to a shade lighter than the map's parchment. */
  readonly color?: string;
  /** Width of the backing around the outline, in CSS pixels. Defaults to about a tenth of the shield's width. */
  readonly width?: number;
}

export interface DrawShieldOptions {
  /** A soft paper backing so the shield reads on busy land, roads and washes. */
  readonly halo?: boolean | ShieldHalo;
  /** Ink colour for the outline and partition lines. */
  readonly ink?: string;
  /**
   * Device pixels per canvas unit. Read from the context's current transform when omitted, which is right
   * whenever the canvas was scaled by devicePixelRatio. Used to keep lines at least one device pixel wide.
   */
  readonly pixelRatio?: number;
  /** Painted texture: pooled edges, light and granulation. On by default. */
  readonly texture?: boolean;
}

const HALO_PAPER = '#f3e9d1';

/** Appends the shield outline to a path (a context or a Path2D), for hit testing or custom strokes. */
export function shieldPath(target: PathSink, x: number, y: number, width: number): void {
  tracePath(target, shieldOutline(), x, y, width);
}

/**
 * Draws `design` as a heater shield `width` wide and `width * SHIELD_ASPECT` tall with its top-left at (x, y).
 * The ink outline and halo extend slightly beyond that box. The context's state is restored afterwards.
 */
export function drawShield(ctx: ShieldContext, design: ShieldDesign, x: number, y: number, width: number,
  options: DrawShieldOptions = {}): void {
  if (!(width > 0)) return;
  const ink = options.ink ?? SHIELD_INK;
  const pr = options.pixelRatio ?? transformScale(ctx);
  const device = width * pr; // shield width in device pixels
  const texture = options.texture ?? true;

  // Line weights in CSS pixels, then in shield units. The outline grows slowly with size and never drops
  // below one device pixel; partition lines are finer.
  const outlinePx = Math.max(0.6 + 0.03 * width, 1 / pr);
  const innerPx = Math.max(outlinePx * 0.5, 0.75 / pr);
  const unit = 1 / width;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width, width);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const outline = shieldOutline();
  const region = secondRegion(design.pattern, design.line);

  if (options.halo) {
    const halo = options.halo === true ? {} : options.halo;
    const haloPx = halo.width ?? Math.max(1.25, Math.min(4, width * 0.07));
    const color = halo.color ?? HALO_PAPER;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = color;
    // A soft margin of paper first, faint, so it settles into the land rather than glowing...
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = (outlinePx + haloPx * 2.4) * unit;
    begin(ctx, outline);
    ctx.stroke();
    // ...then the crisp rim of paper the shield was cut from.
    ctx.globalAlpha = 1;
    ctx.lineWidth = (outlinePx + haloPx * 1.2) * unit;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  begin(ctx, outline);
  ctx.clip();

  // The two washes.
  ctx.fillStyle = pigment(design.field);
  ctx.fillRect(-0.2, -0.2, 1.4, SHIELD_ASPECT + 0.4);
  if (region) {
    ctx.fillStyle = pigment(design.second);
    fillPiece(ctx, region);
  }

  // Pigment pooling where each wash dried against its edges.
  if (texture) {
    const poolAlpha = smoothstep(14, 40, device) * 0.55;
    if (poolAlpha > 0) {
      ctx.lineWidth = Math.max(0.045, 1.6 / device);
      ctx.globalAlpha = poolAlpha;
      for (const [tincture, clip] of washes(design, region)) {
        ctx.save();
        clipTo(ctx, clip);
        ctx.strokeStyle = TINCTURES[tincture].pooled;
        begin(ctx, outline);
        if (region) tracePath(ctx, region.d);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  drawCharges(ctx, design, region, ink, innerPx * unit, smoothstep(22, 44, device));

  if (texture) paintLight(ctx, design, device);

  // Partition lines in fine ink.
  if (region) {
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.6 + 0.3 * smoothstep(16, 48, device);
    ctx.lineWidth = innerPx * unit;
    ctx.beginPath();
    tracePath(ctx, region.d);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore(); // clip

  // The outline, with a faint engraved inner rule on large shields.
  ctx.strokeStyle = ink;
  ctx.lineWidth = outlinePx * unit;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 4;
  begin(ctx, outline);
  ctx.stroke();
  const rule = smoothstep(56, 110, device);
  if (rule > 0) {
    ctx.globalAlpha = rule * 0.45;
    ctx.lineWidth = innerPx * 0.7 * unit;
    begin(ctx, shieldOutline(0.04));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------

function drawCharges(ctx: ShieldContext, design: ShieldDesign, region: PathPiece | null, ink: string,
  inkWidth: number, inkAlpha: number): void {
  const charge = design.charge;
  if (!charge) return;
  const spots = chargeSpots(design);
  const shape = chargeShape(charge.kind);
  const paint = (tincture: Tincture): void => {
    for (const s of spots) {
      const half = s.size / 2;
      // Ink first, then the fill over it: only the outer half of each stroke survives, so overlapping pieces
      // read as one silhouette with a single outline.
      if (inkAlpha > 0) {
        ctx.globalAlpha = inkAlpha * 0.9;
        ctx.strokeStyle = ink;
        ctx.lineWidth = inkWidth * 1.6;
        for (const piece of shape.pieces) {
          ctx.beginPath();
          tracePath(ctx, piece.d, s.x, s.y, half);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pigment(tincture);
      for (const piece of shape.pieces) {
        ctx.beginPath();
        tracePath(ctx, piece.d, s.x, s.y, half);
        ctx.fill(piece.evenOdd ? 'evenodd' : 'nonzero');
      }
    }
  };
  if (charge.tincture !== 'counterchanged') {
    paint(charge.tincture);
    return;
  }
  // Counterchanged: the charge takes the second tincture over the field and the field's tincture over the second.
  paint(design.second);
  if (region) {
    ctx.save();
    clipTo(ctx, region);
    paint(design.field);
    ctx.restore();
  }
}

/** A gentle light from the upper left and pigment settling to the lower right, then granulation. */
function paintLight(ctx: ShieldContext, design: ShieldDesign, device: number): void {
  const light = ctx.createLinearGradient(0, 0, 0.9, SHIELD_ASPECT);
  light.addColorStop(0, 'rgba(255, 249, 232, 0.2)');
  light.addColorStop(0.45, 'rgba(255, 249, 232, 0)');
  light.addColorStop(0.7, 'rgba(70, 42, 18, 0)');
  light.addColorStop(1, 'rgba(70, 42, 18, 0.16)');
  ctx.fillStyle = light;
  ctx.fillRect(-0.2, -0.2, 1.4, SHIELD_ASPECT + 0.4);

  const grain = smoothstep(30, 60, device);
  if (grain <= 0) return;
  let state = design.grain || 0x9e3779b9;
  const next = (): number => {
    // xorshift32: the same arms always granulate the same way.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x1_0000_0000;
  };
  const count = Math.min(900, Math.round(device * device * SHIELD_ASPECT / 36));
  const px = 1 / device;
  for (let i = 0; i < count; i++) {
    const gx = next(), gy = next() * SHIELD_ASPECT, r = (0.45 + next() * 0.8) * px, a = next();
    const dark = a < 0.78;
    ctx.fillStyle = dark ? `rgba(52, 32, 16, ${(0.06 + a * 0.08) * grain})` : `rgba(255, 250, 236, ${0.12 * grain})`;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const EVERYWHERE = polygon([[-1, -1], [2, -1], [2, SHIELD_ASPECT + 1], [-1, SHIELD_ASPECT + 1]]);

/** Each wash with the area it covers: the field is everything outside the second region. */
function washes(design: ShieldDesign, region: PathPiece | null): Array<[Tincture, PathPiece | null]> {
  if (!region) return [[design.field, null]];
  // Sub-paths of a region never overlap, so adding a frame around them inverts the region under even-odd.
  return [[design.field, { d: [...EVERYWHERE, ...region.d], evenOdd: true }], [design.second, region]];
}

function clipTo(ctx: ShieldContext, region: PathPiece | null): void {
  if (region === null) return;
  ctx.beginPath();
  tracePath(ctx, region.d);
  ctx.clip(region.evenOdd ? 'evenodd' : 'nonzero');
}

function fillPiece(ctx: ShieldContext, piece: PathPiece): void {
  ctx.beginPath();
  tracePath(ctx, piece.d);
  ctx.fill(piece.evenOdd ? 'evenodd' : 'nonzero');
}

function begin(ctx: ShieldContext, d: readonly PathCommand[]): void {
  ctx.beginPath();
  tracePath(ctx, d);
}

function pigment(t: Tincture): string {
  return TINCTURES[t].pigment;
}

function transformScale(ctx: ShieldContext): number {
  const m = ctx.getTransform();
  const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return s > 0 && Number.isFinite(s) ? s : 1;
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
