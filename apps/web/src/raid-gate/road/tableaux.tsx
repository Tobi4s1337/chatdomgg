import { For, Show, type JSX } from 'solid-js';
import { armsOf, dress, Gate, Ground, ramp, Walker } from './procession';

/**
 * The raid road's two gate tableaux, staged over each kingdom's own valley until the kingdom host has a gate anchor
 * in the world (spec 23 RG10 decision): the party gathering at the leaving kingdom's Raid Gate and setting out through
 * it, and the same party arriving at the destination's gate to its monarch and its gift. Every figure stands for a
 * person the authority counted (the viewer, the opted-in walkers as a count, the monarch, a host with a real offer);
 * a large party draws at most `COLUMN` and says how many more there are.
 */

export const COLUMN = 9;
const GATE_X = 1060;
const MOUTH = GATE_X + 100;
/** Where the n-th of the party stands, nearest the gate first. */
const spot = (index: number) => GATE_X - 70 - index * 68;
const WALK_SPEED = 300;
const STRIDE = 48;

export type Words = Readonly<{ eyebrow: string; title: string; line: string }>;

function Stage(props: { label: string; words: Words; simulated: boolean; children: JSX.Element; class?: string; reveal: number }) {
  return <section class={`rr-stage ${props.class ?? ''}`} aria-label={props.label} style={{ '--reveal': String(props.reveal) }}>
    <header class="rr-words" aria-live="polite">
      <p class="rr-eyebrow">{props.words.eyebrow}</p>
      <h2 class="rr-title">{props.words.title}</h2>
      <p class="rr-line">{props.words.line}</p>
    </header>
    <div class="rr-scene" aria-hidden="true">
      <svg viewBox="0 0 1400 360" preserveAspectRatio="xMinYMax meet">{props.children}</svg>
    </div>
    <Show when={props.simulated}><p class="rr-chip"><span class="rg-pip" />SIMULATED</p></Show>
  </section>;
}

export type GatheringProps = Readonly<{
  kingdomId: string; name: string;
  /** Presentation seconds when each place in the party was filled, in the order people chose to march. */
  seats: readonly number[];
  /** This viewer's place in the party, if they chose to march. */
  you: number | null;
  /** Presentation seconds now. */
  time: number;
  /** 0…1 through the setting out, 0 before Twitch's raid is witnessed. */
  setout: number;
  words: Words;
  simulated: boolean;
  /** 0…1: the tableau fading as the kingdom rises into the map. */
  fade: number;
}>;

/** The leaving kingdom's Raid Gate waking: braziers lit, banners unfurled, the party walking in, then out through it. */
export function Gathering(props: GatheringProps) {
  const arms = () => armsOf(props.kingdomId);
  const drawn = () => Math.min(COLUMN, props.seats.length);
  const more = () => props.seats.length - drawn();
  const lit = () => ramp(0.2, 2.6, props.time) * (1 - props.fade * 0.6);
  /** Where the n-th marcher is, and how far they have walked (for their step). */
  const place = (index: number) => {
    const seated = props.seats[index]!;
    const target = spot(index);
    const walked = Math.max(0, (props.time - seated) * WALK_SPEED);
    const arrivedX = Math.min(target, -90 + walked);
    let x = arrivedX, phase: number | undefined = arrivedX < target ? walked / STRIDE : undefined, depth = 0;
    if (props.setout > 0) {
      // The column steps off one after another, the banner first, and walks into the arch.
      const go = Math.max(0, props.setout * 3.4 - 0.35 - index * 0.16) * WALK_SPEED * 0.62;
      x = arrivedX + go;
      if (go > 0) phase = go / STRIDE;
      depth = Math.max(0, Math.min(1, (x - (MOUTH - 14)) / 60));
      x = Math.min(x, MOUTH + 6);
    }
    return { x, phase, depth };
  };
  const monarch = () => {
    if (props.setout <= 0) return { x: MOUTH - 18, phase: undefined as number | undefined, depth: 0, facing: 'left' as const };
    const go = Math.max(0, props.setout * 3.4 - 0.15) * WALK_SPEED * 0.5;
    return { x: Math.min(MOUTH + 4, MOUTH - 18 + go), phase: go > 0 ? go / STRIDE : undefined, depth: Math.min(1, go / 46), facing: 'right' as const };
  };
  return <Stage class="rr-gathering" label={`The Raid Gate of ${props.name}`} words={props.words} simulated={props.simulated} reveal={1 - props.fade}>
    <Ground gate={GATE_X} warmth={lit()} />
    <Gate x={GATE_X} arms={arms()} kingdomId={props.kingdomId} name={props.name} lit={lit()} unfurl={ramp(0.6, 2.4, props.time)} time={props.time} />
    <Walker {...monarch()} cloak={arms().field} trim={arms().second} skin="#d7a27a" hair="#2a1c12" crown time={props.time} seed={99} />
    <For each={Array.from({ length: drawn() }, (_, index) => index)}>{index => {
      const where = () => place(index);
      return <Walker x={where().x} depth={where().depth} phase={where().phase} facing="right" {...dress(arms(), index)}
        pennant={index === 0 ? undefined : dress(arms(), index).pennant} standard={index === 0 ? arms() : undefined} torch={index !== 0}
        you={props.you === index && props.setout < 0.5} time={props.time} seed={index} />;
    }}</For>
    <Gate x={GATE_X} arms={arms()} kingdomId={props.kingdomId} name={props.name} lit={lit()} unfurl={ramp(0.6, 2.4, props.time)} time={props.time} front />
    <Show when={more() > 0}><text class="rr-more" x={spot(drawn() - 1) - 44} y="270" text-anchor="end" opacity={1 - ramp(0, 0.4, props.setout)}>and {more().toLocaleString('en')} more</text></Show>
  </Stage>;
}

export type ArrivalProps = Readonly<{
  hostId: string; hostName: string; monarchName: string;
  homeId: string;
  /** Everyone of the party who arrived and still stands here, this viewer included. */
  party: number;
  /** A host who brought this viewer a gift, if one did; 0…1 how far the gift has been given. */
  giver: string | null;
  gift: number;
  /** Seconds since the welcome began, and the presentation clock. */
  elapsed: number;
  time: number;
  words: Words;
  simulated: boolean;
  /** 0…1: the tableau appearing as the destination's drawing wakes. */
  reveal: number;
}>;

/** The same party, under the same banner and pennants, walking in to the destination's gate, its monarch and its gift. */
export function Arrival(props: ArrivalProps) {
  const home = () => armsOf(props.homeId);
  const host = () => armsOf(props.hostId);
  const drawn = () => Math.min(COLUMN, Math.max(1, props.party));
  const more = () => props.party - drawn();
  const you = () => (drawn() > 1 ? 1 : 0);
  const place = (index: number) => {
    const target = spot(index) - 40;
    const walked = Math.max(0, (props.elapsed + 0.9 - index * 0.12) * WALK_SPEED * 0.85);
    const x = Math.min(target, -90 - index * 68 + walked);
    return { x, phase: x < target ? walked / STRIDE : undefined };
  };
  const lit = () => 0.7 + 0.3 * ramp(0, 2, props.elapsed);
  return <Stage class="rr-arrival" label={`${props.hostName} welcomes the guests`} words={props.words} simulated={props.simulated} reveal={props.reveal}>
    <Ground gate={GATE_X} warmth={lit()} />
    <Gate x={GATE_X} arms={host()} kingdomId={props.hostId} name={props.hostName} lit={lit()} unfurl={1} time={props.time} />
    <Walker x={MOUTH - 4} facing="left" cloak={host().field} trim={host().second} skin="#d7a27a" hair="#2a1c12" crown time={props.time} seed={77} />
    <Show when={props.giver}>
      <Walker x={MOUTH - 54} facing="left" cloak={host().second} trim={host().field} skin="#c58c64" hair="#3b2617" gift={0.4 + props.gift * 0.6} time={props.time} seed={78} />
    </Show>
    <For each={Array.from({ length: drawn() }, (_, index) => index)}>{index => {
      const where = () => place(index);
      return <Walker x={where().x} phase={where().phase} facing="right" {...dress(home(), index)}
        pennant={index === 0 ? undefined : dress(home(), index).pennant} standard={index === 0 ? home() : undefined} torch={index !== 0}
        you={index === you()} time={props.time} seed={index} />;
    }}</For>
    <Gate x={GATE_X} arms={host()} kingdomId={props.hostId} name={props.hostName} lit={lit()} unfurl={1} time={props.time} front />
    <Show when={more() > 0}><text class="rr-more" x={spot(drawn() - 1) - 84} y="270" text-anchor="end">and {more().toLocaleString('en')} more</text></Show>
  </Stage>;
}
