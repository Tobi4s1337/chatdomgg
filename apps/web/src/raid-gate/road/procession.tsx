import { For, Show } from 'solid-js';
import { shieldDesign, TINCTURES, type Tincture } from '../../atlas/heraldry';
import { Seal } from '../Seal';

/**
 * The people and the gate of the raid road's two tableaux, drawn in the gate's voxel manner (RG10's welcome, made
 * seekable). Everything moves from the `time` and progress the director passes in, never from CSS clocks, so a
 * capture or a seek lands on the same frame. Warm light is additive bloom: at stream distance it reads as light.
 */

export type Swatch = Readonly<{ main: string; deep: string }>;
export type Arms = Readonly<{ field: Swatch; second: Swatch }>;

export function armsOf(kingdomId: string): Arms {
  const design = shieldDesign(kingdomId);
  const swatch = (tincture: Tincture): Swatch => ({ main: TINCTURES[tincture].pigment, deep: TINCTURES[tincture].pooled });
  return { field: swatch(design.field), second: swatch(design.second) };
}

/**
 * Pennant dyes for the people in a party. Each marcher carries their own small pennant beside the kingdom's banner;
 * the dye is chosen by place in the column, never from who they are, so the picture names nobody.
 */
export const DYES = ['#c9772c', '#3f7f8c', '#b8435a', '#7a8c3a', '#d6a640', '#6c5aa0', '#2f7a58', '#c25d3a', '#8a6a4a', '#4d74b8', '#a8507f'] as const;
export const SKIN = ['#e3b48f', '#c58c64', '#8d5a3b', '#f0c9a6', '#a96d47', '#d9a27c', '#6e452d', '#eabf97', '#b97d55'] as const;
export const HAIR = ['#3b2617', '#1f1712', '#6b4325', '#2b1d14', '#8a5a2f', '#151010', '#4a2f1c', '#a8743f', '#2f2118'] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const ramp = (from: number, to: number, v: number) => {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Gradients shared by both tableaux; ids are prefixed so the page can hold both at once. */
export function RoadDefs() {
  return <svg class="rr-defs" width="0" height="0" aria-hidden="true">
    <defs>
      <linearGradient id="rr-fade-x" x1="0" x2="1"><stop offset="0" stop-color="#fff" /><stop offset=".9" stop-color="#fff" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></linearGradient>
      <mask id="rr-ground-fade" maskContentUnits="userSpaceOnUse"><rect x="-400" y="0" width="1800" height="400" fill="url(#rr-fade-x)" /></mask>
      <radialGradient id="rr-bloom"><stop offset="0" stop-color="#ffd38a" stop-opacity=".95" /><stop offset=".25" stop-color="#ffa64a" stop-opacity=".55" /><stop offset=".6" stop-color="#ff7a2a" stop-opacity=".14" /><stop offset="1" stop-color="#ff7a2a" stop-opacity="0" /></radialGradient>
      <radialGradient id="rr-flame" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff6d8" /><stop offset=".35" stop-color="#ffd27a" /><stop offset=".75" stop-color="#ff8a2e" /><stop offset="1" stop-color="#e2501d" stop-opacity="0" /></radialGradient>
      <radialGradient id="rr-arch-lit" cx=".5" cy=".9" r=".85"><stop offset="0" stop-color="#ffd896" /><stop offset=".4" stop-color="#e08a42" /><stop offset="1" stop-color="#3b2016" /></radialGradient>
      <radialGradient id="rr-arch-dark" cx=".5" cy=".9" r=".85"><stop offset="0" stop-color="#3a2a32" /><stop offset="1" stop-color="#16121c" /></radialGradient>
      <linearGradient id="rr-road" x1="0" x2="1"><stop offset="0" stop-color="#3a3140" stop-opacity="0" /><stop offset=".35" stop-color="#6d5640" /><stop offset=".85" stop-color="#b98a52" /><stop offset="1" stop-color="#d9a462" /></linearGradient>
      <linearGradient id="rr-stone" x1="0" x2="1"><stop offset="0" stop-color="#6f6a78" /><stop offset=".55" stop-color="#8b8592" /><stop offset="1" stop-color="#5a5562" /></linearGradient>
    </defs>
  </svg>;
}

/** The ground the tableau stands on: a road warming toward the gate. */
export function Ground(props: { gate: number; warmth: number }) {
  // The ground and its road run out softly into the kingdom beyond, never as a hard strip's end.
  return <g mask="url(#rr-ground-fade)">
    <path fill="#1a1824" d="M0 330C260 316 600 312 900 308S1240 302 1400 300V360H0Z" />
    <path d="M0 324C300 316 640 314 940 310S1260 304 1400 302L1400 316C1240 318 980 322 940 324S320 332 0 344Z" fill="url(#rr-road)" opacity={0.45 + props.warmth * 0.45} />
    <ellipse cx={props.gate + 110} cy="304" rx="460" ry="74" fill="url(#rr-bloom)" class="rr-bloom" opacity={props.warmth * 0.55} />
  </g>;
}

/**
 * A kingdom's gate: two stone towers, the arch between them lit from inside as it wakes, the kingdom's banners
 * unfurling on both towers, its arms on the keystone and a brazier either side. `front` draws only the right tower's
 * face, laid over a party that walks into the arch.
 */
export function Gate(props: {
  x: number; arms: Arms; kingdomId: string; name: string; lit: number; unfurl: number; time: number; front?: boolean;
}) {
  const banner = (bx: number, delay: number) => {
    const open = ramp(delay, delay + 0.5, props.unfurl);
    const sway = Math.sin(props.time * 1.8 + bx) * 4 * open;
    return <g transform={`translate(${bx} 108) skewX(${sway}) scale(1 ${0.05 + open * 0.95})`}>
      <path d="M0 0h38v78l-19-13-19 13Z" fill={props.arms.field.main} />
      <path d="M19 0v66" stroke={props.arms.second.main} stroke-width="8" />
      <path d="M0 0h38v6H0z" fill={props.arms.field.deep} />
    </g>;
  };
  if (props.front) {
    return <g transform={`translate(${props.x} 0)`} shape-rendering="crispEdges">
      <rect x="148" y="96" width="66" height="206" fill="url(#rr-stone)" />
      <For each={[0, 1, 2, 3]}>{i => <rect x={148 + i * 17} y="84" width="11" height="12" fill="#7b7584" />}</For>
      <For each={[0, 1, 2, 3, 4, 5]}>{i => <rect x="148" y={112 + i * 30} width="66" height="2" fill="#57525f" />}</For>
      {banner(162, 0.25)}
      <Brazier x={228} lit={ramp(0.18, 0.5, props.lit)} time={props.time} seed={2} />
    </g>;
  }
  return <g transform={`translate(${props.x} 0)`}>
    <g shape-rendering="crispEdges">
      <rect x="-14" y="96" width="66" height="206" fill="url(#rr-stone)" />
      <For each={[0, 1, 2, 3]}>{i => <rect x={-14 + i * 17} y="84" width="11" height="12" fill="#7b7584" />}</For>
      <rect x="52" y="120" width="96" height="182" fill="#4d4855" />
      <path d="M60 302V180a40 40 0 0 1 80 0v122Z" fill="url(#rr-arch-dark)" />
      <path d="M60 302V180a40 40 0 0 1 80 0v122Z" fill="url(#rr-arch-lit)" opacity={props.lit} />
      <path d="M52 140h96v10H52z" fill="#5f5a68" />
      <For each={[0, 1, 2, 3, 4, 5]}>{i => <rect x="-14" y={112 + i * 30} width="66" height="2" fill="#57525f" />}</For>
      <rect x="-2" y="100" width="4" height="200" fill="#a9a2b0" opacity=".45" />
    </g>
    <ellipse cx="100" cy="270" rx="70" ry="60" fill="url(#rr-bloom)" class="rr-bloom" opacity={props.lit * 0.6} />
    {banner(0, 0)}
    <Brazier x={-34} lit={ramp(0, 0.35, props.lit)} time={props.time} seed={1} />
    <foreignObject class="rr-gate-seal" x="66" y="16" width="68" height="68" style={{ opacity: 0.25 + props.unfurl * 0.75 }}><Seal kingdomId={props.kingdomId} size={62} label={`Arms of ${props.name}`} /></foreignObject>
  </g>;
}

export function Brazier(props: { x: number; lit: number; time: number; seed: number }) {
  const flick = 1 + Math.sin(props.time * 9.7 + props.seed * 2.1) * 0.07 + Math.sin(props.time * 23.3 + props.seed) * 0.04;
  return <g transform={`translate(${props.x} 0)`}>
    <circle cx="16" cy="252" r="96" fill="url(#rr-bloom)" class="rr-bloom" opacity={props.lit * (0.9 + 0.1 * flick)} />
    <rect x="12" y="270" width="8" height="32" fill="#2d2420" shape-rendering="crispEdges" />
    <path d="M2 258h28l-5 13H7Z" fill="#3a2d25" />
    <g transform={`translate(16 258) scale(${props.lit * (2 - flick) * 0.5 + props.lit * 0.5} ${props.lit * flick}) translate(-16 -258)`}>
      <path d="M16 224c8 10 12 18 9 28-2 5-16 5-18 0-3-9 2-15 9-28Z" fill="url(#rr-flame)" />
    </g>
    <Embers x={16} y={232} time={props.time} seed={props.seed} strength={props.lit} />
  </g>;
}

/** Sparks lifting off a flame, placed by time so every frame is reproducible. */
function Embers(props: { x: number; y: number; time: number; seed: number; strength: number }) {
  return <For each={[0, 1, 2]}>{i => {
    const life = () => (props.time * 0.42 + props.seed * 0.37 + i * 0.33) % 1;
    return <circle class="rr-ember" cx={props.x + Math.sin((life() + i) * 5) * 8 * life() + (i - 1) * 3} cy={props.y - life() * 76} r={1.6 - life()}
      opacity={props.strength * (life() < 0.12 ? life() / 0.12 : 1 - life())} />;
  }}</For>;
}

export type WalkerProps = Readonly<{
  x: number;
  /** Depth into the arch: 0 on the road, 1 gone through it. */
  depth?: number | undefined;
  facing: 'left' | 'right';
  cloak: Swatch; trim: Swatch; skin: string; hair: string;
  /** Walk-cycle phase in turns; undefined stands still. */
  phase?: number | undefined;
  time: number;
  torch?: boolean | undefined;
  /** The kingdom's banner (the first of the party carries it). */
  standard?: Arms | undefined;
  /** This marcher's own pennant dye. */
  pennant?: string | undefined;
  crown?: boolean | undefined;
  gift?: number | undefined;
  you?: boolean | undefined;
  seed: number;
}>;

/** One person in the voxel manner: block head, hood, a cloak in their kingdom's colours, legs that step in turn. */
export function Walker(props: WalkerProps) {
  const flip = () => (props.facing === 'left' ? -1 : 1);
  const swing = () => (props.phase === undefined ? 0 : Math.sin(props.phase * Math.PI * 2));
  const bob = () => (props.phase === undefined ? 0 : -Math.abs(Math.sin(props.phase * Math.PI * 2)) * 3);
  const depth = () => props.depth ?? 0;
  const shrink = () => 1 - depth() * 0.42;
  const flick = () => 1 + Math.sin(props.time * 11 + props.seed * 1.7) * 0.08;
  return <g class="rr-walker" opacity={1 - ramp(0.55, 1, depth())}
    transform={`translate(${props.x} ${302 - depth() * 34}) scale(${shrink()}) translate(0 -302) scale(${flip()} 1)`}>
    <Show when={props.torch}><ellipse cx="10" cy="300" rx="72" ry="12" fill="url(#rr-bloom)" class="rr-bloom" opacity=".7" /><circle cx="17" cy={198 + bob()} r="86" fill="url(#rr-bloom)" class="rr-bloom" opacity={0.85 + 0.15 * (flick() - 1) * 6} /></Show>
    <ellipse cx="0" cy="300" rx="18" ry="4" fill="#120d14" opacity=".55" />
    <g shape-rendering="crispEdges">
      <rect x={-8 + swing() * 3} y="270" width="7" height="29" fill="#2a2228" />
      <rect x={2 - swing() * 3} y="270" width="7" height="29" fill="#352b31" />
    </g>
    <g transform={`translate(0 ${bob()})`}>
      <g shape-rendering="crispEdges">
        <path d="M-14 226h28l5 48h-38Z" fill={props.cloak.main} />
        <path d="M-14 226h6l-4 48h-7Z" fill={props.cloak.deep} />
        <path d="M-15 258h30v5h-30z" fill={props.trim.main} opacity=".9" />
        <rect x="-9" y="204" width="18" height="20" fill={props.skin} />
        <rect x="-11" y="200" width="22" height="9" fill={props.hair} />
        <path d="M-12 200h24v6h-4v-2h-16v14h-4Z" fill={props.cloak.deep} />
        <rect x="4" y="211" width="3" height="3" fill="#1d1418" />
        <Show when={props.crown}><path d="M-10 194h20v6h-20zM-10 188h4v6h-4zM-2 186h4v8h-4zM6 188h4v6h-4z" fill="#e2b14c" /><rect x="-1" y="189" width="2" height="2" fill="#b3352a" /></Show>
        <rect x="11" y="206" width="2" height="66" fill="#ffc479" opacity=".5" />
      </g>
      <Show when={props.pennant}>{dye => <g>
        {/* Their own pennant, on a short staff over the shoulder. */}
        <path d="M-10 268L-16 168" stroke="#4a3020" stroke-width="3" />
        <path d={`M-16 170l-${26} ${7 + Math.sin(props.time * 2.3 + props.seed) * 2}l${26} 9Z`} fill={dye()} />
        <path d="M-16 170l-8 2v12l8 2Z" fill="#00000033" />
      </g>}</Show>
      <Show when={props.torch}>
        <path d="M10 234l9-26" stroke="#4a3020" stroke-width="4" stroke-linecap="square" />
        <g transform={`translate(19 206) scale(${2 - flick()} ${flick()}) skewX(${Math.sin(props.time * 7 + props.seed) * 5}) translate(-19 -206)`}>
          <path d="M19 184c6 7 9 13 7 20-2 4-12 4-13 0-2-7 2-12 6-20Z" fill="url(#rr-flame)" />
        </g>
        <Embers x={19} y={188} time={props.time} seed={props.seed} strength={1} />
      </Show>
      <Show when={props.standard}>{arms => <g>
        <path d="M14 298V132" stroke="#4a3020" stroke-width="4" />
        <g transform={`translate(16 136) skewX(${Math.sin(props.time * 1.9 + props.seed) * 6})`}>
          <path d="M0 0h36v56l-18-11-18 11Z" fill={arms().field.main} />
          <path d="M18 0v44" stroke={arms().second.main} stroke-width="7" />
          <path d="M0 0h36v5H0z" fill={arms().field.deep} />
        </g>
        <circle cx="14" cy="130" r="4" fill="#d9a74e" />
      </g>}</Show>
      <Show when={props.gift !== undefined && props.gift > 0}>
        <circle cx="16" cy="242" r={26 + 8 * (props.gift ?? 0)} fill="url(#rr-bloom)" class="rr-bloom" opacity={props.gift} />
        <rect x="11" y="236" width="11" height="11" fill="#e8b45b" stroke="#6a4420" stroke-width="1.5" shape-rendering="crispEdges" />
      </Show>
    </g>
    <Show when={props.you}>
      <g transform={`scale(${flip()} 1)`}><path d="M0 154l6 7-6 7-6-7Z" fill="#f2c56e" /><text class="rr-you" x="0" y="146" text-anchor="middle">You</text></g>
    </Show>
  </g>;
}

/** Dress for the n-th of a party: their kingdom's colours on the cloak, their own pennant, a face and hair. */
export function dress(arms: Arms, index: number) {
  return {
    cloak: index % 3 === 2 ? arms.second : arms.field,
    trim: index % 3 === 2 ? arms.field : arms.second,
    skin: SKIN[index % SKIN.length]!,
    hair: HAIR[(index * 4 + 1) % HAIR.length]!,
    pennant: DYES[index % DYES.length]!,
  };
}
