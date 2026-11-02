// Twitch's number and time formats, as the channel page shows them.

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US');

/** Side bar viewers and About followers: 827, 1.7K, 14.6K, 254K, 1.2M. */
export const shortCount = (n: number): string => compact.format(Math.max(0, Math.round(n)));

/** The viewer count under the follow button: 37, 1,585. */
export const fullCount = (n: number): string => full.format(Math.max(0, Math.round(n)));

/** The uptime clock: H:MM:SS. */
export function uptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Smoothstep on 0..1, for eased moves that are pure functions of t. */
export const smooth = (x: number): number => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** The follower goal a small channel would set: the next round number above its count. */
export function followerGoal(followers: number): number {
  const step = followers < 100 ? 25 : followers < 1000 ? 100 : followers < 10_000 ? 500 : 5000;
  return (Math.floor(followers / step) + 1) * step;
}

// ---- Name colours on the dark theme.

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
const contrast = (a: readonly number[], b: readonly number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parseHex = (hex: string) => { const h = hex.replace('#', ''); const v = h.length === 3 ? [...h].map(c => c + c).join('') : h; return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };

function toHsl([r, g, b]: readonly number[]): [number, number, number] {
  const R = r! / 255, G = g! / 255, B = b! / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h: number, s: number, l: number): number[] {
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hue = (t: number) => { const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255));
}

const readable = new Map<string, string>();
/**
 * A chat name colour as the dark theme shows it. Twitch keeps the colour a chatter picked but raises its lightness
 * (in HSL, so the hue stays) just until it reads against the chat background at a WCAG contrast of 4.5:1, the
 * rule its colour tools follow. Colours that already read are left as they are: pure blue #0000FF becomes a
 * light periwinkle, dodger blue stays dodger blue.
 */
export function readableColor(hex: string, background = '#18181b'): string {
  const key = `${hex}|${background}`;
  const known = readable.get(key);
  if (known) return known;
  const bg = parseHex(background);
  let rgb = parseHex(hex);
  if (rgb.some(v => Number.isNaN(v))) return hex;
  const [h, s, l0] = toHsl(rgb);
  for (let l = l0; contrast(rgb, bg) < 4.5 && l < 1; ) { l = Math.min(1, l + 0.01); rgb = fromHsl(h, s, l); }
  const out = `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  readable.set(key, out);
  return out;
}
