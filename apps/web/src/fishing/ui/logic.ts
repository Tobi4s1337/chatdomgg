/* Pure pieces of the pier's catch tag, fight gauge, notes and world tags. No DOM here, so the rules can be tested in node. */

export const clamp01 = (value: number): number => (value > 0 ? (value < 1 ? value : 1) : 0);

/** One frame value to an index into a table of precomputed strings, so per-frame writes never format numbers. */
export function quantize(value: number, steps: number): number {
  return Math.round(clamp01(Number.isFinite(value) ? value : 0) * steps);
}

/** The tag's measure line: "412 g · 31 cm". Empty parts are left out rather than shown as gaps. */
export function measureLine(weight: string, length: string): string {
  const a = weight.trim(), b = length.trim();
  return a && b ? `${a} · ${b}` : a || b;
}

/** The words a screen reader hears when the tag arrives. */
export function tagSummary(tag: { readonly name: string; readonly weight: string; readonly length: string; readonly personalFirst: boolean; readonly kingdomFirst: boolean }, kingdomName: string): string {
  const measure = [tag.weight.trim(), tag.length.trim()].filter(Boolean).join(', ');
  const parts = [`You caught a ${tag.name}${measure ? `, ${measure}` : ''}.`];
  if (tag.personalFirst) parts.push('New in your Almanac.');
  if (tag.kingdomFirst) parts.push(`${firstInLine(kingdomName)}.`);
  return parts.join(' ');
}

/** The wax seal's words. A kingdom without a name still gets an honest line. */
export function firstInLine(kingdomName: string): string {
  const name = kingdomName.trim();
  return name ? `First in ${name}` : 'First in the kingdom';
}

export interface TagStamp {
  readonly seal: 'almanac' | 'kingdom';
  /** When the stamp starts its fall, ms after the tag starts to slide in. */
  readonly at: number;
  /** When it meets the paper: the moment the stamp sound plays. */
  readonly impact: number;
}
export interface TagTimeline {
  readonly slideIn: number;
  readonly stamps: readonly TagStamp[];
  /** When the tag starts to slide out on its own. */
  readonly out: number;
  readonly slideOut: number;
}

export const TAG_SLIDE_MS = 540;
export const TAG_SLIDE_REDUCED_MS = 220;
export const TAG_SLIDE_OUT_MS = 380;
export const TAG_HOLD_MS = 5000;
/** The beat between the tag settling and the Almanac stamp coming down. */
export const STAMP_DELAY_MS = 600;
export const STAMP_GAP_MS = 440;
/** The stamp's fall: impact lands this long after it starts. */
export const STAMP_FALL_MS = 110;
export const STAMP_SETTLE_MS = 300;
/** After the last stamp, the tag stays long enough to read what it says. */
export const READ_AFTER_STAMP_MS = 2800;

/** The catch tag's beats. Reduced motion keeps the same rhythm and only shortens the slide (it becomes a fade). */
export function tagTimeline(personalFirst: boolean, kingdomFirst: boolean, reduced: boolean): TagTimeline {
  const slideIn = reduced ? TAG_SLIDE_REDUCED_MS : TAG_SLIDE_MS;
  const stamps: TagStamp[] = [];
  let at = TAG_SLIDE_MS + STAMP_DELAY_MS - STAMP_FALL_MS;
  if (personalFirst) { stamps.push({ seal: 'almanac', at, impact: at + STAMP_FALL_MS }); at += STAMP_GAP_MS; }
  if (kingdomFirst) stamps.push({ seal: 'kingdom', at, impact: at + STAMP_FALL_MS });
  const last = stamps.length ? stamps[stamps.length - 1]!.impact + STAMP_SETTLE_MS : 0;
  return { slideIn, stamps, out: Math.max(TAG_SLIDE_MS + TAG_HOLD_MS, last + READ_AFTER_STAMP_MS), slideOut: reduced ? TAG_SLIDE_REDUCED_MS : TAG_SLIDE_OUT_MS };
}

/** How long a note stays: long enough to read at an unhurried pace, never lingering. */
export function noteDuration(message: string): number {
  return Math.round(Math.min(7000, Math.max(2800, 2000 + message.trim().length * 55)));
}

/* The fight gauge: a shallow brass arc whose needle pivots far below it. */
export const GAUGE = Object.freeze({ width: 200, height: 48, cx: 100, cy: 168, radius: 150, spanDeg: 32, strainOn: 0.85, strainOff: 0.82, tensionSteps: 400, colourSteps: 64 });

export interface Point { readonly x: number; readonly y: number }
/** A point on a circle around the pivot; 0° is straight up, positive is clockwise. */
export function polar(cx: number, cy: number, radius: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}
const fixed = (value: number): string => (Math.round(value * 100) / 100).toString();

/** An SVG arc from fraction `from` to fraction `to` of the gauge's span, left to right. */
export function arcPath(radius: number, from = 0, to = 1, g: { readonly cx: number; readonly cy: number; readonly spanDeg: number } = GAUGE): string {
  const a = -g.spanDeg + 2 * g.spanDeg * clamp01(from), b = -g.spanDeg + 2 * g.spanDeg * clamp01(to);
  const start = polar(g.cx, g.cy, radius, a), end = polar(g.cx, g.cy, radius, b);
  return `M${fixed(start.x)} ${fixed(start.y)}A${fixed(radius)} ${fixed(radius)} 0 0 1 ${fixed(end.x)} ${fixed(end.y)}`;
}

/** Engraved ticks across the bezel: long ones at quarters, short ones between. */
export function tickPath(count: number, inner: number, outer: number, g: { readonly cx: number; readonly cy: number; readonly spanDeg: number } = GAUGE): string {
  let d = '';
  for (let i = 0; i <= count; i += 1) {
    const deg = -g.spanDeg + (2 * g.spanDeg * i) / count;
    const long = i % Math.max(1, Math.round(count / 4)) === 0;
    const a = polar(g.cx, g.cy, long ? inner - 1.5 : inner, deg), b = polar(g.cx, g.cy, outer, deg);
    d += `M${fixed(a.x)} ${fixed(a.y)}L${fixed(b.x)} ${fixed(b.y)}`;
  }
  return d;
}

/** The needle's lean for a tension, in degrees from upright. */
export const needleDegrees = (tension: number, spanDeg = GAUGE.spanDeg): number => (clamp01(tension) - 0.5) * 2 * spanDeg;

/** Line colour along the gauge: cool slack line, warm working line, ember near the limit, red at the snap. */
const STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 0x86, 0xa9, 0xb4], [0.45, 0xd9, 0xc0, 0x7a], [0.7, 0xe2, 0x9a, 0x48], [0.86, 0xd2, 0x5e, 0x2c], [1, 0xc0, 0x2e, 0x1e],
];
export function tensionColour(tension: number): string {
  const t = clamp01(Number.isFinite(tension) ? tension : 0);
  let i = 1;
  while (i < STOPS.length - 1 && t > STOPS[i]![0]) i += 1;
  const a = STOPS[i - 1]!, b = STOPS[i]!, k = (t - a[0]) / (b[0] - a[0] || 1);
  const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(a[1] + (b[1] - a[1]) * k)}${hex(a[2] + (b[2] - a[2]) * k)}${hex(a[3] + (b[3] - a[3]) * k)}`;
}

/** The fine shiver near snapping, with a little hysteresis so it never flickers at the threshold. */
export function strained(previous: boolean, tension: number): boolean {
  return previous ? tension > GAUGE.strainOff : tension > GAUGE.strainOn;
}

export type TensionWord = 'slack' | 'taut' | 'straining' | 'about to snap';
export function tensionWord(tension: number): TensionWord {
  return tension >= GAUGE.strainOn ? 'about to snap' : tension >= 0.62 ? 'straining' : tension >= 0.25 ? 'taut' : 'slack';
}

/** Draw rectangle for an image fitted inside a box, centred, never upscaled past `maxScale`. */
export function containFit(sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number, pad = 0, maxScale = Number.POSITIVE_INFINITY): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return null;
  const w = Math.max(0, boxWidth - pad * 2), h = Math.max(0, boxHeight - pad * 2);
  if (w <= 0 || h <= 0) return null;
  const scale = Math.min(w / sourceWidth, h / sourceHeight, maxScale);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/** World tags that come and go: which entries leave this frame. Pure bookkeeping for the DOM pool. */
export interface TagPoolEntry { seen: number; visible: boolean; leavingSince: number }
export const WORLD_TAG_FADE_MS = 700;
/** A tag fades when its caller marks it hidden or stops sending it; it may come back while fading. */
export function worldTagLeaving(entry: TagPoolEntry, frame: number): boolean {
  return entry.seen !== frame || !entry.visible;
}
/** Positions are written at half-pixel steps; a tag that has not moved is not written again. */
export const snapHalf = (value: number): number => Math.round(value * 2) / 2;
