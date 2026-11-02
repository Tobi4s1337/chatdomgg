/**
 * Small hand-inked emblems for the gift shelf, one per catalogue gift, drawn like stamps on parchment.
 * Every colour comes from a CSS custom property with a fallback, so the shelf can tint a state
 * (a cancelled gift greys out) without touching the drawing. No ids, so many copies can share a page.
 */
import { For, type JSX } from 'solid-js';

const TONE = {
  i: 'var(--emblem-ink, #6b4a30)',
  f: 'var(--emblem-fill, #d9b77e)',
  a: 'var(--emblem-accent, #a84a33)',
  l: 'var(--emblem-leaf, #6f7d45)',
  p: 'var(--emblem-paper, #f4e6c8)',
  n: 'none',
} as const;
type Tone = keyof typeof TONE;
type Extra = { at?: string; stroke?: Tone; width?: number; evenodd?: boolean };
type Shape = readonly [d: string, fill?: Tone, extra?: Extra];

const ring = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const star = (x: number, y: number, r: number, points = 5, inner = 0.45) => `M${Array.from({ length: points * 2 }, (_, k) => {
  const angle = Math.PI * (k / points - 0.5);
  const d = k % 2 ? r * inner : r;
  return `${(x + d * Math.cos(angle)).toFixed(1)} ${(y + d * Math.sin(angle)).toFixed(1)}`;
}).join('L')}Z`;
/** Five round petals around a point, as one scalloped outline. */
const flower = (x: number, y: number, r: number) => {
  const p = (k: number) => `${(x + r * 0.6 * Math.cos(Math.PI * (k * 0.4 - 0.5))).toFixed(1)} ${(y + r * 0.6 * Math.sin(Math.PI * (k * 0.4 - 0.5))).toFixed(1)}`;
  const arc = (r * 0.44).toFixed(1);
  return `M${p(0)}${[1, 2, 3, 4, 5].map(k => `A${arc} ${arc} 0 1 1 ${p(k)}`).join('')}Z`;
};
const at = (x: number, y: number, turn = 0): Extra => ({ at: `translate(${x} ${y}) rotate(${turn})` });
/** The same little house wherever a gift is about a home; scaled houses keep the common line weight. */
const house = (x: number, y: number, size = 1, door = true): Shape[] => {
  const place: Extra = { at: `translate(${x} ${y}) scale(${size})`, width: +(1.8 / size).toFixed(2) };
  return [
    ['M-9 0v-12h18v12Z', 'p', place],
    ['M-12-11 0-21l12 10Z', 'f', place],
    ...(door ? [['M-2.5 0v-5a2.5 2.5 0 0 1 5 0v5Z', 'i', place] as const] : []),
  ];
};
/** Triangle flags hanging from a gentle curve, alternating two tones. */
const flags = (x0: number, x1: number, y: number, sag: number, count: number): Shape[] => {
  const spots = Array.from({ length: count }, (_, k) => {
    const t = (k + 0.75) / (count + 0.5);
    return [x0 + (x1 - x0) * t, y + 4 * sag * t * (1 - t)] as const;
  });
  const draw = (odd: number) => spots.filter((_, k) => k % 2 === odd).map(([x, fy]) => `M${(x - 3.4).toFixed(1)} ${fy.toFixed(1)}h6.8L${x.toFixed(1)} ${(fy + 7.5).toFixed(1)}Z`).join('');
  return [[`M${x0} ${y}q${(x1 - x0) / 2} ${2 * sag} ${x1 - x0} 0`], [draw(0), 'a'], [draw(1), 'l']];
};
const petal = (x: number, y: number, turn: number, fill: Tone): Shape => ['M0-5c3.5 2 3.5 7 0 10-3.5-3-3.5-8 0-10Z', fill, at(x, y, turn)];
const paper = (x: number, y: number, turn: number, fill: Tone): Shape => ['M-3-1.8h6v3.6h-6Z', fill, at(x, y, turn)];
const band = (d: string, tone: Tone): Shape[] => [[d, 'n', { stroke: 'i', width: 5 }], [d, 'n', { stroke: tone, width: 2 }]];
const swing = { at: 'rotate(-10 22 9)' };

const EMBLEMS: Record<string, () => Shape[]> = {
  friendfireworks: () => [
    ...house(24, 43, 1.15),
    ['M24 3.5V6M24 14v2.5M15.5 10H18M30 10h2.5M18 4l1.8 1.8M28.2 14.2 30 16M30 4l-1.8 1.8M19.8 14.2 18 16'],
    [star(24, 10, 3.4, 4, 0.35), 'a'],
    [ring(10, 9, 1.2) + ring(38, 8, 1.2) + ring(39, 18, 1), 'i'],
  ],
  streetlanterns: () => [
    ['M10 6h4v30h-4Z', 'f'],
    ['M14 10h20M14 22c7 0 12-5 13-12M32 10v5'],
    ['M26.5 20l2.5-5h6l2.5 5Z', 'i'],
    ['M27.5 20h9l1.5 8.5-1.5 8.5h-9L26 28.5Z', 'f'],
    ['M30 23h4v11h-4Z', 'a'],
    ['M28.5 37h7l-1 3h-5Z', 'i'],
  ],
  kites: () => [
    ['M31 4l9 10-9 14-9-14Z', 'a'],
    ['M22 14h18M31 4v24M31 28c-3 3 3 5 0 8s3 4 0 7'],
    ['M14 12l7 8-7 11-7-11Z', 'f'],
    ['M7 20h14M14 12v19M14 31c-3 3 3 4 0 7s3 3 0 5'],
  ],
  bell: () => [
    ['M12 6h20M5 22c-1.5 3-1.5 7 0 10M9 24c-.8 2-.8 4 0 6M41 25c1.5 3 1.5 7 0 10'],
    ['M22 6v5', 'n', swing],
    ['M12.5 33c1-3 1.5-7 1.5-13a8 8 0 0 1 16 0c0 6 .5 10 1.5 13Z', 'f', swing],
    ['M10 33h24a1.6 1.6 0 0 1 0 3.2H10a1.6 1.6 0 0 1 0-3.2Z', 'f', swing],
    ['M22 36.2v2' + ring(22, 40.2, 2.2), 'a', swing],
  ],
  bunting: () => [
    ...house(24, 44, 1.3, false),
    [ring(24, 24, 2.3), 'p'],
    ...flags(8.4, 39.6, 29.7, 5.5, 3),
  ],
  parade: () => [
    ['M8 14v29M19 7v36M30 11v32'],
    ['M8 14l10 3.5L8 21Z', 'a'],
    ['M19 7l10 3.5L19 14Z', 'l'],
    ['M30 11l10 3.5L30 18Z', 'a'],
    ...band('M8 25q5.5 7 11 0q5.5 7 11 0', 'f'),
    [ring(8, 12.5, 1.4) + ring(19, 5.5, 1.4) + ring(30, 9.5, 1.4), 'f'],
  ],
  feast: () => [
    ['M10 34v9M38 34v9'],
    ['M7 28c0-7 4.5-11 10-11s10 4 10 11ZM14 22l1 2.5M20 22l-1 2.5', 'f'],
    ['M39.5 15c4 0 4 7 0 8.5'],
    ['M29.5 28c-2-5 0-9 2.5-11v-5h6v5c2.5 2 4.5 6 2.5 11ZM31 12h8', 'a'],
    ['M5 27h38v5c-3 2.5-6.5 2.5-9.5 0-3 2.5-6.5 2.5-9.5 0-3 2.5-6.5 2.5-9.5 0-3 2.5-6.5 2.5-9.5 0Z', 'p'],
  ],
  bardverse: () => [
    ['M12 11h20v24H12Z', 'p'],
    ['M16 17h11M16 21.5h8M16 26h10M16 30.5h6'],
    ['M10 7h24a2.5 2.5 0 0 1 0 5H10a2.5 2.5 0 0 1 0-5ZM10 34h24a2.5 2.5 0 0 1 0 5H10a2.5 2.5 0 0 1 0-5Z', 'f'],
    ['M42 6c-8 1-14 9-15 20 7-3 14-11 15-20Z', 'a'],
    ['M42 6 25 33'],
  ],
  flowerpetals: () => [
    ['M5 23c4-2 7 0 11-1M28 20c4-1 7 1 11 0M14 43c4-2 7 0 10-1'],
    petal(13, 12, -35, 'a'), petal(31, 10, 40, 'p'), [flower(23, 25, 7), 'p'], [ring(23, 25, 1.4), 'f'],
    petal(37, 30, -55, 'a'), petal(11, 33, 70, 'p'), petal(28, 39, 25, 'a'),
  ],
  paperboats: () => [
    ['M6 22h36l-7 9H13Z', 'p'],
    ['M15 22l9-15 9 15Z', 'f'],
    ['M24 7v15'],
    ['M5 36q4.75-3 9.5 0t9.5 0 9.5 0 9.5 0M10 41q4.75-3 9.5 0t9.5 0 9.5 0'],
  ],
  ribbonarch: () => [
    ['M9 43V23a15 15 0 0 1 30 0v20h-6V23a9 9 0 0 0-18 0v20Z', 'f'],
    ['M23 12l-4.5 8.5 3-.3 2.5-4.2ZM25 12l4.5 8.5-3-.3-2.5-4.2Z', 'a'],
    ['M24 11c-3-5-10-5-10-1s7 4 10 1ZM24 11c3-5 10-5 10-1s-7 4-10 1Z' + ring(24, 11, 2), 'a'],
  ],
  plazaflowers: () => [
    ['M10 26C10 7 38 7 38 26'],
    [flower(15.5, 20, 7) + flower(32.5, 20, 7), 'a'],
    [flower(24, 16, 7.5), 'p'],
    [ring(15.5, 20, 1.4) + ring(32.5, 20, 1.4) + ring(24, 16, 1.5), 'f'],
    ['M7 25h34v4H7Z', 'f'],
    ['M8.5 29h31l-3 14h-25ZM16 29.5l1 13M24 29.5v13M32 29.5l-1 13', 'f'],
  ],
  friendflowers: () => [
    ['M5 43h38'],
    ['M7 43V17a9 9 0 0 1 18 0v26Z', 'a'],
    ['M16 8v35'],
    [ring(20.5, 28, 1.1), 'i'],
    [flower(35, 27, 6.5), 'a'], [flower(27, 26, 7), 'p'],
    [ring(35, 27, 1.3) + ring(27, 26, 1.4), 'f'],
    ['M20.5 32h21l-2.5 11H23ZM27 32.5v10M34 32.5v10', 'f'],
  ],
  confetti: () => [
    ['M13 5v3M13 18v3M5 13h3M18 13h3M7.3 7.3l2 2M16.7 16.7l2 2M18.7 7.3l-2 2M9.3 16.7l-2 2'],
    [star(13, 13, 3, 4, 0.35), 'a'],
    paper(31, 9, 20, 'a'), paper(39, 20, -30, 'f'), paper(26, 24, 45, 'l'),
    paper(10, 31, -15, 'f'), paper(21, 39, 30, 'p'), paper(36, 35, -60, 'a'),
    ['M16 28c2-3 4 1 6-2M30 15c1-3 4-1 5-4M28 43c2-2 4 1 6-1'],
  ],
  skybanners: () => [
    ['M9 7v36M5 43h8'],
    [ring(9, 5.5, 1.6), 'f'],
    ['M9 9c6-3 11 2 17 0s10-2 15 0l-3 5 3 5c-5-2-10-1-15 0s-11 3-17 0Z', 'a'],
    ['M9 24c5-2 9 2 14 0s7-1 10 0l-2.5 4 2.5 4c-3-1-7-1-10 0s-9 2-14 0Z', 'f'],
  ],
  picnic: () => [
    ['M5 40l7-12h31l-7 12Z', 'p'],
    ['M9.7 32h31M7.3 36h31M15.3 40l7-12M25.7 40l7-12', 'n', { stroke: 'a', width: 2.4 }],
    ['M5 40l7-12h31l-7 12Z'],
    ['M19 19c0-9 11-9 11 0'],
    ['M16 22h17l-2 11H18Z', 'f'],
    ['M15 19h19v3.5H15Z', 'f'],
  ],
  pinwheels: () => [
    ['M24 18v25M20 43h8'],
    ...[0, 90, 180, 270].map((turn, k): Shape => ['M24 18V5q9 0 11 7.5Z', k % 2 ? 'p' : 'a', { at: `rotate(${turn} 24 18)` }]),
    [ring(24, 18, 1.6), 'f'],
  ],
  starribbons: () => [
    ['M15 22v6M33 22v6M24 14v5'],
    ...band('M6 13q9 15 18 0q9 15 18 0', 'a'),
    [star(15, 33, 6.5) + star(33, 33, 6.5), 'p'],
    [star(24, 23.5, 4.5), 'f'],
  ],
  gatewreath: () => [
    [ring(24, 22, 14.5) + ring(24, 22, 7.5), 'l', { evenodd: true }],
    [Array.from({ length: 10 }, (_, k) => {
      const a = (k / 10) * Math.PI * 2;
      const x = 24 + 11 * Math.cos(a);
      const y = 22 + 11 * Math.sin(a);
      return `M${(x - 1.6 * Math.sin(a + 0.6)).toFixed(1)} ${(y + 1.6 * Math.cos(a + 0.6)).toFixed(1)}L${(x + 1.6 * Math.sin(a + 0.6)).toFixed(1)} ${(y - 1.6 * Math.cos(a + 0.6)).toFixed(1)}`;
    }).join(''), 'n', { stroke: 'p', width: 1.4 }],
    [ring(14, 13, 1.8) + ring(34, 13, 1.8) + ring(24, 8.5, 1.8), 'a'],
    ['M23 36l-4.5 6.5 3 .3 2.5-4ZM25 36l4.5 6.5-3 .3-2.5-4Z', 'a'],
    ['M24 36c-3-4-9-4-9-.5s6 3.5 9 .5ZM24 36c3-4 9-4 9-.5s-6 3.5-9 .5Z' + ring(24, 36, 2), 'a'],
  ],
  friendpennant: () => [
    ['M9 7v36M5 43h8'],
    [ring(9, 5.5, 1.6), 'f'],
    ['M9 8l17 5.5L9 19Z', 'a'],
    ...house(30.5, 43),
  ],
};
const GENERIC = (): Shape[] => [[star(24, 24, 18, 4, 0.3), 'f'], [ring(24, 24, 3.5), 'p']];

/** Decorative only: hidden from assistive technology and never a tab stop (focusable is missing from Solid's SVG types). */
const QUIET = { 'aria-hidden': 'true', focusable: 'false' } as JSX.SvgSVGAttributes<SVGSVGElement>;

/** The catalogue ids that have a drawn emblem. */
export const GIFT_EMBLEM_IDS: readonly string[] = Object.keys(EMBLEMS);

export function GiftEmblem(props: { giftId: string; class?: string }): JSX.Element {
  const shapes = () => (EMBLEMS[props.giftId] ?? GENERIC)();
  return (
    <svg {...QUIET} viewBox="0 0 48 48" class={props.class ?? ""} fill="none" stroke={TONE.i} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <For each={shapes()}>{([d, fill = 'n', extra]) => (
        <path d={d} fill={TONE[fill]} transform={extra?.at} stroke={extra?.stroke && TONE[extra.stroke]} stroke-width={extra?.width} fill-rule={extra?.evenodd ? 'evenodd' : undefined} />
      )}</For>
    </svg>
  );
}
