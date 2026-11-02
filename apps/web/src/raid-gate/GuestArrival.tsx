import { createMemo, For, Show } from 'solid-js';
import { shieldDesign, TINCTURES, type Tincture } from '../atlas/heraldry';
import type { WelcomeView } from '../../../api/src/raid-gate/contracts';
import type { WelcomeSnapshot } from './welcome';
import { incoming } from './welcome';
import { Seal } from './Seal';

/**
 * The welcome at the destination's gate, staged for the stream (spec 23 R6, R13; RG10): the visiting party walks in a
 * torchlit column under its own kingdom's banner, and the destination's monarch and the hosts who brought gifts wait in
 * the gate's light. Every figure stands for a real person the authority counted: this viewer, the others of the same
 * witnessed raid who arrived and still stand here (a count, never a roster), the monarch, and hosts with a real offer.
 * A large party draws at most `COLUMN` walkers and says how many more there are; nobody is invented from a raid count.
 */
export type GuestArrivalProps = Readonly<{
  welcome: WelcomeSnapshot;
  /** Names as the kingdom host and the Atlas show them. */
  homeName: string;
  hostName: string;
  hostKingdomId: string;
  homeKingdomId: string;
}>;

/** Walkers drawn in the column; the rest are told as a number. */
export const COLUMN = 9;
const HOSTS_DRAWN = 2;

type Swatch = Readonly<{ main: string; deep: string }>;
function banner(kingdomId: string): Readonly<{ field: Swatch; second: Swatch }> {
  const design = shieldDesign(kingdomId);
  const swatch = (tincture: Tincture): Swatch => ({ main: TINCTURES[tincture].pigment, deep: TINCTURES[tincture].pooled });
  return { field: swatch(design.field), second: swatch(design.second) };
}

/** Skin and hair tones per walker, chosen by place in the column so a reload draws the same party. */
const SKIN = ['#e3b48f', '#c58c64', '#8d5a3b', '#f0c9a6', '#a96d47', '#d9a27c', '#6e452d', '#eabf97', '#b97d55'] as const;
const HAIR = ['#3b2617', '#1f1712', '#6b4325', '#2b1d14', '#8a5a2f', '#151010', '#4a2f1c', '#a8743f', '#2f2118'] as const;

export function GuestArrivalPane(props: GuestArrivalProps) {
  const view = (): WelcomeView | null => props.welcome.view;
  const home = createMemo(() => banner(props.homeKingdomId));
  const host = createMemo(() => banner(props.hostKingdomId));
  const party = () => 1 + (view()?.party ?? 0);
  const drawn = () => Math.min(COLUMN, party());
  const more = () => party() - drawn();
  /** Hosts who have offered this visitor something, by name, in the order they offered. */
  const givers = createMemo(() => {
    const v = view();
    if (!v) return [];
    const names: string[] = [];
    for (const offer of [...v.offers].reverse()) {
      if (!incoming(v, offer) || offer.from === v.monarch.personId) continue;
      const name = offer.fromName ?? 'A host';
      if (!names.includes(name)) names.push(name);
    }
    return names.slice(0, HOSTS_DRAWN);
  });
  const monarchName = () => view()?.monarch.name ?? `${props.hostName}'s monarch`;
  const gate = 940;
  // The column fills the road up to the gate; the viewer walks second, behind the banner-bearer.
  const spacing = () => Math.min(86, 700 / Math.max(1, drawn()));
  const walkerX = (index: number) => gate - 150 - index * spacing();
  const you = () => (drawn() > 1 ? 1 : 0);

  return <section class="rg-welcome-stage" aria-label={`${props.hostName} welcomes the guests of ${props.homeName}`}>
    <header class="rg-welcome-words">
      <p class="rg-welcome-eyebrow">The gate of {props.hostName}</p>
      <h2 class="rg-welcome-title">{props.hostName} welcomes the guests of {props.homeName}</h2>
      <p class="rg-welcome-line">
        {party() === 1 ? `You walk in under ${props.homeName}'s banner.` : `You and ${party() - 1} more of ${props.homeName}'s party walk in under its banner.`}
        {' '}{monarchName()} receives you at the gate{givers().length ? `, with ${givers().join(' and ')}` : ''}.
      </p>
    </header>
    <div class="rg-welcome-scene" aria-hidden="true">
      <svg viewBox="0 0 1200 340" preserveAspectRatio="xMinYMax meet">
        <defs>
          <radialGradient id="rg-w-bloom"><stop offset="0" stop-color="#ffd38a" stop-opacity=".95" /><stop offset=".25" stop-color="#ffa64a" stop-opacity=".55" /><stop offset=".6" stop-color="#ff7a2a" stop-opacity=".14" /><stop offset="1" stop-color="#ff7a2a" stop-opacity="0" /></radialGradient>
          <radialGradient id="rg-w-flame" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff6d8" /><stop offset=".35" stop-color="#ffd27a" /><stop offset=".75" stop-color="#ff8a2e" /><stop offset="1" stop-color="#e2501d" stop-opacity="0" /></radialGradient>
          <radialGradient id="rg-w-arch" cx=".5" cy=".85" r=".8"><stop offset="0" stop-color="#ffcf86" /><stop offset=".45" stop-color="#d9823d" /><stop offset="1" stop-color="#3b2016" /></radialGradient>
          <linearGradient id="rg-w-road" x1="0" x2="1"><stop offset="0" stop-color="#3a3140" stop-opacity="0" /><stop offset=".35" stop-color="#6d5640" /><stop offset=".85" stop-color="#b98a52" /><stop offset="1" stop-color="#d9a462" /></linearGradient>
          <linearGradient id="rg-w-stone" x1="0" x2="1"><stop offset="0" stop-color="#6f6a78" /><stop offset=".55" stop-color="#8b8592" /><stop offset="1" stop-color="#5a5562" /></linearGradient>
        </defs>
        {/* The road, warming as it nears the gate. */}
        <path class="rg-w-ground" d="M0 318C220 300 520 296 760 292S1100 286 1200 284V340H0Z" />
        <path d="M0 312C260 302 560 300 800 296S1080 290 1200 288L1200 300C1060 302 840 306 800 308S300 318 0 330Z" fill="url(#rg-w-road)" opacity=".85" />
        <ellipse class="rg-w-haze" cx="900" cy="290" rx="420" ry="70" fill="url(#rg-w-bloom)" opacity=".5" />

        {/* The destination's gate: two voxel towers, an arch lit from the kingdom inside, its banners and braziers. */}
        <g class="rg-w-gate" transform={`translate(${gate} 0)`} shape-rendering="crispEdges">
          <rect x="-12" y="96" width="64" height="196" fill="url(#rg-w-stone)" />
          <rect x="148" y="96" width="64" height="196" fill="url(#rg-w-stone)" />
          <For each={[0, 1, 2, 3]}>{i => <><rect x={-12 + i * 17} y="84" width="11" height="12" fill="#7b7584" /><rect x={148 + i * 17} y="84" width="11" height="12" fill="#7b7584" /></>}</For>
          <rect x="52" y="120" width="96" height="172" fill="#4d4855" />
          <path d="M60 292V178a40 40 0 0 1 80 0v114Z" fill="url(#rg-w-arch)" />
          <path d="M52 140h96v10H52z" fill="#5f5a68" />
          <For each={[0, 1, 2, 3, 4, 5]}>{i => <rect x="-12" y={110 + i * 30} width="64" height="2" fill="#57525f" />}</For>
          <For each={[0, 1, 2, 3, 4, 5]}>{i => <rect x="148" y={110 + i * 30} width="64" height="2" fill="#57525f" />}</For>
          <rect x="0" y="100" width="4" height="190" fill="#a9a2b0" opacity=".5" />
          <g class="rg-w-banner"><path d={`M2 108h36v74l-18-12-18 12Z`} fill={host().field.main} /><path d="M20 108v62" stroke={host().second.main} stroke-width="8" /><path d="M2 108h36v6H2z" fill={host().field.deep} /></g>
          <g class="rg-w-banner rg-w-banner-late"><path d={`M162 108h36v74l-18-12-18 12Z`} fill={host().field.main} /><path d="M180 108v62" stroke={host().second.main} stroke-width="8" /><path d="M162 108h36v6h-36z" fill={host().field.deep} /></g>
          <Brazier x={-30} /><Brazier x={226} />
        </g>

        {/* The hosts in the gate's light: the monarch, and anyone who brought a gift. */}
        <Person x={gate + 100} facing="left" cloak={host().field} trim={host().second} skin="#d7a27a" hair="#2a1c12" crown />
        <For each={givers()}>{(_, index) => <Person x={gate + 52 - index() * 34} facing="left" cloak={host().second} trim={host().field} skin={SKIN[(index() + 4) % SKIN.length]!} hair={HAIR[(index() + 2) % HAIR.length]!} gift />}</For>

        {/* The visiting column, each walker with a torch, the first carrying home's banner. */}
        <For each={Array.from({ length: drawn() }, (_, index) => index)}>{index => <Person
          x={walkerX(index)} facing="right" cloak={index % 3 === 2 ? home().second : home().field} trim={index % 3 === 2 ? home().field : home().second}
          skin={SKIN[index % SKIN.length]!} hair={HAIR[(index * 4 + 1) % HAIR.length]!} torch={index !== 0} standard={index === 0} you={index === you()}
          step={index} />}</For>
        <Show when={more() > 0}><text class="rg-w-more" x={walkerX(drawn() - 1) - 54} y="262" text-anchor="end">and {more().toLocaleString('en')} more</text></Show>
        {/* The destination's arms hang on the keystone above the arch. */}
        <foreignObject class="rg-welcome-seal" x={gate + 100 - 34} y="18" width="68" height="68"><Seal kingdomId={props.hostKingdomId} size={62} label={`Arms of ${props.hostName}`} /></foreignObject>
      </svg>
    </div>
  </section>;
}

function Brazier(props: { x: number }) {
  return <g transform={`translate(${props.x} 0)`}>
    <circle cx="16" cy="248" r="92" fill="url(#rg-w-bloom)" class="rg-w-bloom" />
    <rect x="12" y="262" width="8" height="30" fill="#2d2420" shape-rendering="crispEdges" />
    <path d="M2 252h28l-5 12H7Z" fill="#3a2d25" />
    <path class="rg-w-flame" d="M16 222c8 10 12 18 9 26-2 5-16 5-18 0-3-8 2-14 9-26Z" fill="url(#rg-w-flame)" />
    <For each={[0, 1, 2]}>{i => <circle class="rg-w-ember" cx={12 + i * 4} cy="232" r="1.6" style={{ '--d': `${i * 0.9 + (props.x > 0 ? 0.4 : 0)}s`, '--dx': `${(i - 1) * 9}px` }} />}</For>
  </g>;
}

/**
 * One person in the voxel manner: block head, hood, a cloak in their kingdom's colours, legs that step in turn. A torch
 * (with its bloom and embers), a standard, a crown or a lit gift as the moment needs. `you` marks this viewer.
 */
function Person(props: {
  x: number; facing: 'left' | 'right'; cloak: Swatch; trim: Swatch; skin: string; hair: string;
  torch?: boolean; standard?: boolean; crown?: boolean; gift?: boolean; you?: boolean; step?: number;
}) {
  const flip = () => props.facing === 'left' ? -1 : 1;
  return <g class="rg-w-person" classList={{ 'rg-w-walking': props.step !== undefined }} style={{ '--step': `${((props.step ?? 0) % 4) * -0.23}s` }}
    transform={`translate(${props.x} 0) scale(${flip()} 1)`}>
    <Show when={props.torch}><ellipse cx="10" cy="292" rx="70" ry="12" fill="url(#rg-w-bloom)" opacity=".75" /><circle cx="17" cy="192" r="84" fill="url(#rg-w-bloom)" class="rg-w-bloom" /></Show>
    <g class="rg-w-body" shape-rendering="crispEdges">
      <ellipse cx="0" cy="292" rx="18" ry="4" fill="#120d14" opacity=".55" />
      <rect class="rg-w-leg-a" x="-8" y="262" width="7" height="28" fill="#2a2228" />
      <rect class="rg-w-leg-b" x="2" y="262" width="7" height="28" fill="#352b31" />
      <path d="M-14 218h28l5 48h-38Z" fill={props.cloak.main} />
      <path d="M-14 218h6l-4 48h-7Z" fill={props.cloak.deep} />
      <path d="M-15 250h30v5h-30z" fill={props.trim.main} opacity=".9" />
      <rect x="-9" y="196" width="18" height="20" fill={props.skin} />
      <rect x="-11" y="192" width="22" height="9" fill={props.hair} />
      <path d="M-12 192h24v6h-4v-2h-16v14h-4Z" fill={props.cloak.deep} />
      <rect x="4" y="203" width="3" height="3" fill="#1d1418" />
      <Show when={props.crown}><path d="M-10 186h20v6h-20zM-10 180h4v6h-4zM-2 178h4v8h-4zM6 180h4v6h-4z" fill="#e2b14c" /><rect x="-1" y="181" width="2" height="2" fill="#b3352a" /></Show>
      {/* Warm rim light from the torches on the side that faces them. */}
      <rect x="11" y="198" width="2" height="66" fill="#ffc479" opacity=".55" />
    </g>
    <Show when={props.torch}>
      <g class="rg-w-torch">
        <path d="M10 226l9-26" stroke="#4a3020" stroke-width="4" stroke-linecap="square" />
        <path class="rg-w-flame" d="M19 178c6 7 9 13 7 19-2 4-12 4-13 0-2-6 2-11 6-19Z" fill="url(#rg-w-flame)" />
        <For each={[0, 1]}>{i => <circle class="rg-w-ember" cx={18 + i * 3} cy="182" r="1.3" style={{ '--d': `${((props.step ?? 0) * 0.37 + i * 1.1) % 2.6}s`, '--dx': `${i ? 7 : -5}px` }} />}</For>
      </g>
    </Show>
    <Show when={props.standard}>
      <g class="rg-w-standard">
        <path d="M14 290V128" stroke="#4a3020" stroke-width="4" />
        <path class="rg-w-banner" d="M16 132h34v52l-17-10-17 10Z" fill={props.cloak.main} />
        <path d="M33 132v40" stroke={props.trim.main} stroke-width="6" />
        <circle cx="14" cy="126" r="4" fill="#d9a74e" />
      </g>
    </Show>
    <Show when={props.gift}>
      <circle cx="16" cy="234" r="26" fill="url(#rg-w-bloom)" class="rg-w-bloom" />
      <rect x="11" y="228" width="11" height="11" fill="#e8b45b" stroke="#6a4420" stroke-width="1.5" shape-rendering="crispEdges" />
    </Show>
    <Show when={props.you}>
      <g transform={`scale(${flip()} 1)`}><path d="M0 160l6 7-6 7-6-7Z" fill="#f2c56e" /><text class="rg-w-you" x="0" y="152" text-anchor="middle">You</text></g>
    </Show>
  </g>;
}
