import { createUniqueId, Show, type JSX } from 'solid-js';
import { CHARGE, SHIELD, blazonOf, chargeTransform } from './crest';
import { contrast, parseHex } from './ink';
import type { CrestView } from './types';

/** The charge of a crest in one tincture: filled parts even-odd, wave bands stroked. Shared by arms, ink and wax. */
export function ChargeMark(props: { crest: Pick<CrestView, 'shape' | 'charge'>; fill: string; outline?: string; outlineWidth?: number }): JSX.Element {
  const art = () => CHARGE[props.crest.charge];
  return <g transform={chargeTransform(props.crest.shape)}>
    <Show when={props.outline}>
      <Show when={art().fill}><path d={art().fill} fill="none" stroke={props.outline} stroke-width={(props.outlineWidth ?? 1.2) * 2} stroke-linejoin="round" /></Show>
      <Show when={art().stroke}><path d={art().stroke} fill="none" stroke={props.outline} stroke-width={(art().strokeWidth ?? 6) + (props.outlineWidth ?? 1.2) * 2} stroke-linecap="round" /></Show>
    </Show>
    <Show when={art().fill}><path d={art().fill} fill={props.fill} fill-rule="evenodd" /></Show>
    <Show when={art().stroke}><path d={art().stroke} fill="none" stroke={props.fill} stroke-width={art().strokeWidth} stroke-linecap="round" /></Show>
  </g>;
}

/**
 * The kingdom's arms painted from its crest record: field in the first tincture, the charge in the second, a
 * bordure in the third and a chief in the fourth when the arms supply them, all washed and outlined in iron-gall.
 * An approved painted asset is resolved by the host; until one is supplied the record's own grammar is drawn.
 */
export function CrestArms(props: { crest: CrestView; kingdomName: string; size: number; class?: string; decorative?: boolean }): JSX.Element {
  const id = createUniqueId();
  const colour = (index: number) => props.crest.colours[index];
  const field = () => colour(0)!;
  const charge = () => colour(1) ?? colour(0)!;
  // A charge that would vanish into its field (pale on pale) is fimbriated in ink, as a herald would.
  const needsOutline = () => contrast(parseHex(field()), parseHex(charge())) < 1.6;
  return <svg class={`pp-arms${props.class ? ` ${props.class}` : ''}`} viewBox="0 0 100 110" width={props.size} height={props.size * 1.1}
    {...(props.decorative ? { 'aria-hidden': 'true' as const } : { role: 'img', 'aria-label': `Arms of ${props.kingdomName}: ${blazonOf(props.crest.shape, props.crest.charge)}` })}>
    <defs>
      <clipPath id={`${id}-clip`}><path d={SHIELD[props.crest.shape]} /></clipPath>
      <linearGradient id={`${id}-wash`} x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stop-color="#fff6e0" stop-opacity=".38" />
        <stop offset=".45" stop-color="#fff6e0" stop-opacity="0" />
        <stop offset="1" stop-color="#1a0c04" stop-opacity=".32" />
      </linearGradient>
    </defs>
    <g clip-path={`url(#${id}-clip)`}>
      <rect width="100" height="110" fill={field()} />
      <Show when={colour(3)}><rect width="100" height="27" fill={colour(3)} /><path d="M0 27H100" stroke="#24160d" stroke-opacity=".45" stroke-width="1.2" /></Show>
      <g transform={colour(3) ? 'translate(7 13) scale(.86)' : undefined}>
        <ChargeMark crest={props.crest} fill={charge()} {...(needsOutline() ? { outline: '#3a2618' } : {})} />
      </g>
      <Show when={colour(2)}><path d={SHIELD[props.crest.shape]} fill="none" stroke={colour(2)} stroke-width="15" /></Show>
      <rect width="100" height="110" fill={`url(#${id}-wash)`} />
    </g>
    <path d={SHIELD[props.crest.shape]} fill="none" stroke="#24160d" stroke-width="2.6" stroke-linejoin="round" />
    <path d={SHIELD[props.crest.shape]} fill="none" stroke="#fff3d6" stroke-opacity=".35" stroke-width=".9" transform="translate(.8 1)" stroke-linejoin="round" />
  </svg>;
}
