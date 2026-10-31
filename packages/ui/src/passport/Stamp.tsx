import { createUniqueId, For, Match, Show, Switch, type JSX } from 'solid-js';
import { ChargeMark } from './Arms';
import { CHARGE, SHIELD } from './crest';
import { stampDate } from './format';
import { crestInks, inkFor, type Ink } from './ink';
import type { CrestView, StampView } from './types';

/**
 * One kingdom's stamp, pressed by hand. The frame follows the arms' own shape (a ring for a round shield, a
 * cartouche for a heater, a cut ribbon for a swallowtail) and carries the charge; the ink is the arms' darkest
 * tincture. A raid also carries a wax seal poured from the arms' strongest colour, pressed with the charge and a
 * thumb. Tilt, slip, pressure, dry patches, broken edges and the seal's corner all come from the record ID.
 * The stamp is decoration: its caption beside it carries every fact in text.
 */
export function PassportStampMark(props: { stamp: StampView; size: number; class?: string }): JSX.Element {
  const id = createUniqueId();
  const ink = () => inkFor(props.stamp.id);
  const inks = () => crestInks(props.stamp.kingdom.crest);
  const word = () => (props.stamp.kind === 'raid' ? 'RAID' : 'VISIT');
  const date = () => stampDate(props.stamp.at);
  const place = () => {
    const i = ink();
    return `translate(${(i.dx * 160).toFixed(1)} ${(i.dy * 160).toFixed(1)}) rotate(${i.rotate} 80 80)`;
  };
  return <svg class={`pp-stamp${props.class ? ` ${props.class}` : ''}`} data-kind={props.stamp.kind} data-shape={props.stamp.kingdom.crest.shape}
    viewBox="0 0 160 160" width={props.size} height={props.size} aria-hidden="true">
    <defs>
      <BrokenInk id={`${id}-ink`} ink={ink()} />
      <linearGradient id={`${id}-dry`} gradientTransform={`rotate(${ink().dryAngle} .5 .5)`}>
        <stop offset="0" stop-color="#fff" stop-opacity="1" />
        <stop offset=".62" stop-color="#fff" stop-opacity=".92" />
        <stop offset="1" stop-color="#fff" stop-opacity=".42" />
      </linearGradient>
      <mask id={`${id}-pad`} maskUnits="userSpaceOnUse" x="-20" y="-20" width="200" height="200">
        <rect x="-20" y="-20" width="200" height="200" fill={`url(#${id}-dry)`} />
      </mask>
      <path id={`${id}-top`} d="M28 80A52 52 0 0 1 132 80" />
      <path id={`${id}-bottom`} d="M19 80A61 61 0 0 0 141 80" />
    </defs>
    <g class="pp-stamp-impression" transform={place()} mask={`url(#${id}-pad)`}>
      <g filter={`url(#${id}-ink)`} opacity={ink().pressure} fill={inks().ink} stroke={inks().ink} color={inks().ink}>
        <Switch>
          <Match when={props.stamp.kingdom.crest.shape === 'round'}>
            <RingFrame id={id} word={word()} date={date()} accent={inks().accent} crest={props.stamp.kingdom.crest} raid={props.stamp.kind === 'raid'} />
          </Match>
          <Match when={props.stamp.kingdom.crest.shape === 'heater'}>
            <CartoucheFrame word={word()} date={date()} accent={inks().accent} crest={props.stamp.kingdom.crest} raid={props.stamp.kind === 'raid'} />
          </Match>
          <Match when={props.stamp.kingdom.crest.shape === 'swallowtail'}>
            <RibbonFrame word={word()} date={date()} accent={inks().accent} crest={props.stamp.kingdom.crest} raid={props.stamp.kind === 'raid'} />
          </Match>
        </Switch>
      </g>
    </g>
    <Show when={props.stamp.kind === 'raid'}>
      <WaxSeal id={`${id}-wax`} crest={props.stamp.kingdom.crest} ink={ink()} />
    </Show>
  </svg>;
}

/** Ink that bled into the fibres and skipped where the pad was thin: displaced edges, blotches and pinholes. */
function BrokenInk(props: { id: string; ink: Ink }): JSX.Element {
  return <filter id={props.id} x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed={props.ink.grain} result="fibre" />
    <feDisplacementMap in="SourceGraphic" in2="fibre" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="bled" />
    <feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed={props.ink.grain + 11} result="blot" />
    <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.4 0 0 0 2.3" result="patchy" />
    <feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed={props.ink.grain + 29} result="pin" />
    <feColorMatrix in="pin" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -10 0 0 0 6.7" result="pinholes" />
    <feComposite in="bled" in2="patchy" operator="in" result="patched" />
    <feComposite in="patched" in2="pinholes" operator="in" />
  </filter>;
}

interface FrameProps { word: string; date: string; accent: string; crest: CrestView; raid: boolean }

const LABEL = { 'font-family': "'IM Fell English SC', Georgia, serif", stroke: 'none' } as const;

/** A short road, walked: dashes ending in a chevron, under the word RAID. */
function Road(props: { x: number; y: number; width: number; colour: string }): JSX.Element {
  return <g stroke={props.colour} fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d={`M${props.x} ${props.y}h${props.width - 8}`} stroke-width="2" stroke-dasharray="4.5 3.2" />
    <path d={`M${props.x + props.width - 9} ${props.y - 4}l5 4l-5 4`} stroke-width="2" />
  </g>;
}

/** A diamond rule: a visit is a quiet arrival, not a march. */
function Rule(props: { x: number; y: number; width: number; colour: string }): JSX.Element {
  const mid = props.x + props.width / 2;
  return <g stroke={props.colour} fill="none" stroke-width="1.4" stroke-linecap="round">
    <path d={`M${props.x} ${props.y}H${mid - 6}M${mid + 6} ${props.y}H${props.x + props.width}`} />
    <path d={`M${mid} ${props.y - 3.5}l3.5 3.5l-3.5 3.5l-3.5-3.5Z`} fill={props.colour} />
  </g>;
}

function RingFrame(props: FrameProps & { id: string }): JSX.Element {
  return <g>
    <circle cx="80" cy="80" r="70" fill="none" stroke-width="3.4" />
    <circle cx="80" cy="80" r="64.5" fill="none" stroke-width="1.1" />
    <circle cx="80" cy="80" r="48" fill="none" stroke-width="1.6" />
    <For each={[0, 1]}>{side => <circle cx={side ? 136.5 : 23.5} cy="80" r="2.6" stroke="none" />}</For>
    <text {...LABEL} font-size="14" letter-spacing="3" text-anchor="middle"><textPath href={`#${props.id}-top`} startOffset="50%">{props.word}</textPath></text>
    <text {...LABEL} font-size="11.5" letter-spacing="1.6" text-anchor="middle" fill={props.accent}><textPath href={`#${props.id}-bottom`} startOffset="50%">{props.date}</textPath></text>
    <g transform="translate(80 80) scale(.74) translate(-50 -56)" stroke="none"><ChargeMark crest={{ ...props.crest, shape: 'round' }} fill="currentColor" /></g>
    <Show when={props.raid}><Road x={62} y={118} width={36} colour={props.accent} /></Show>
  </g>;
}

function CartoucheFrame(props: FrameProps): JSX.Element {
  const outer = 'M28 12H132L148 28V132L132 148H28L12 132V28Z', inner = 'M31 18H129L142 31V129L129 142H31L18 129V31Z';
  return <g>
    <path d={outer} fill="none" stroke-width="3.2" stroke-linejoin="round" />
    <path d={inner} fill="none" stroke-width="1.1" stroke-linejoin="round" />
    <text {...LABEL} x="80" y="40" font-size="15" letter-spacing="3.2" text-anchor="middle">{props.word}</text>
    <Show when={props.raid} fallback={<Rule x={52} y={48} width={56} colour={props.accent} />}><Road x={56} y={48} width={48} colour={props.accent} /></Show>
    <g transform="translate(80 91) scale(.54) translate(-50 -56)">
      <path d={SHIELD.heater} fill="none" stroke-width="4.4" stroke-linejoin="round" />
      <g stroke="none"><ChargeMark crest={props.crest} fill="currentColor" /></g>
    </g>
    <text {...LABEL} x="80" y="136" font-size="12.5" letter-spacing="1.6" text-anchor="middle" fill={props.accent}>{props.date}</text>
  </g>;
}

function RibbonFrame(props: FrameProps): JSX.Element {
  const outer = 'M8 38H152L136 80L152 122H8L24 80Z', inner = 'M17 44H143L129 80L143 116H17L31 80Z';
  return <g>
    <path d={outer} fill="none" stroke-width="3.2" stroke-linejoin="round" />
    <path d={inner} fill="none" stroke-width="1.1" stroke-linejoin="round" />
    <g transform="translate(57 80) scale(.52) translate(-50 -55)">
      <path d={SHIELD.swallowtail} fill="none" stroke-width="4.8" stroke-linejoin="round" />
      <g stroke="none"><ChargeMark crest={props.crest} fill="currentColor" /></g>
    </g>
    <text {...LABEL} x="108" y="77" font-size="14.5" letter-spacing="2.6" text-anchor="middle">{props.word}</text>
    <Show when={props.raid} fallback={<Rule x={88} y={86} width={40} colour={props.accent} />}><Road x={88} y={86} width={40} colour={props.accent} /></Show>
    <text {...LABEL} x="108" y="104" font-size="10.5" letter-spacing="1.1" text-anchor="middle" fill={props.accent}>{props.date}</text>
  </g>;
}

const SEAT: readonly (readonly [number, number])[] = [[128, 126], [126, 34], [34, 128], [36, 36]];

/** Sealing wax poured from the arms' strongest tincture, pressed with the charge and then with a thumb. */
function WaxSeal(props: { id: string; crest: CrestView; ink: Ink }): JSX.Element {
  const inks = () => crestInks(props.crest);
  const seat = () => SEAT[props.ink.sealCorner]!;
  const radius = 25;
  const outline = () => {
    const [a, b, c] = props.ink.pour;
    const points: string[] = [];
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = radius * (1 + Math.sin(t * 3 + a * 6.28) * 0.055 + Math.sin(t * 5 + b * 6.28) * 0.04 + Math.sin(t * 9 + c * 6.28) * 0.025
        + (Math.cos(t - c * 6.28) > 0.93 ? 0.12 : 0));
      points.push(`${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`);
    }
    return `M${points.join('L')}Z`;
  };
  const charge = CHARGE[props.crest.charge];
  const ridges = Array.from({ length: 8 }, (_, i) => 3.5 + i * 2.6);
  return <g class="pp-wax" transform={`translate(${seat()[0]} ${seat()[1]}) rotate(${props.ink.sealTurn})`}>
    <defs>
      <radialGradient id={`${props.id}-body`} cx=".36" cy=".32" r=".78">
        <stop offset="0" stop-color={inks().waxHi} />
        <stop offset=".46" stop-color={inks().wax} />
        <stop offset="1" stop-color={inks().waxLo} />
      </radialGradient>
      <clipPath id={`${props.id}-clip`}><path d={outline()} /></clipPath>
      <filter id={`${props.id}-drop`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0.6" dy="1.8" stdDeviation="1.4" flood-color="#2a1208" flood-opacity=".5" />
      </filter>
    </defs>
    <path d={outline()} fill={`url(#${props.id}-body)`} filter={`url(#${props.id}-drop)`} />
    <g clip-path={`url(#${props.id}-clip)`}>
      {/* The matrix's pressed ring and the field it leaves inside. */}
      <circle r="17.6" fill={inks().waxLo} fill-opacity=".22" />
      <circle r="17.6" fill="none" stroke={inks().waxLo} stroke-width="2.2" />
      <circle r="17.6" fill="none" stroke={inks().waxHi} stroke-opacity=".6" stroke-width=".8" transform="translate(.7 .9)" />
      {/* The charge in relief: lit on its upper edge, shadowed below. */}
      <g transform="scale(.42) translate(-50 -53)">
        <For each={[[-1.5, -1.6, inks().waxHi, 0.8], [1.6, 1.9, inks().waxLo, 0.9], [0, 0, inks().wax, 1]] as const}>{([dx, dy, colour, opacity]) =>
          <g transform={`translate(${dx} ${dy})`} opacity={opacity}>
            <Show when={charge.fill}><path d={charge.fill} fill={colour} fill-rule="evenodd" /></Show>
            <Show when={charge.stroke}><path d={charge.stroke} fill="none" stroke={colour} stroke-width={charge.strokeWidth} stroke-linecap="round" /></Show>
          </g>}</For>
      </g>
      {/* A thumb pressed the cooling wax beside the matrix: its ridges, faint and broken. */}
      <g transform={`rotate(${props.ink.thumbTurn}) translate(13 3)`} fill="none" stroke={inks().waxLo} stroke-opacity=".34" stroke-width=".7">
        <For each={ridges}>{(rx, i) => <ellipse rx={rx} ry={rx * 1.32} stroke-dasharray={`${7 + (i() % 3) * 3} ${1.4 + (i() % 2)}`} />}</For>
      </g>
      <ellipse cx="-8" cy="-11" rx="8" ry="4.6" fill="#fff4e6" fill-opacity=".22" transform="rotate(-28 -8 -11)" />
    </g>
  </g>;
}
