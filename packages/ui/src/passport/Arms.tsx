import { createUniqueId, type JSX } from 'solid-js';
import { blazonOf } from './crest';
import { armsMarkup, chargeMarkup } from './markup';
import type { CrestView } from './types';

/** The charge of a crest in one tincture, for hosts that set it inside their own SVG. */
export function ChargeMark(props: { crest: Pick<CrestView, 'shape' | 'charge'>; fill: string; outline?: string; outlineWidth?: number }): JSX.Element {
  return <g innerHTML={chargeMarkup(props.crest, props.fill, props.outline ? { colour: props.outline, ...(props.outlineWidth === undefined ? {} : { width: props.outlineWidth }) } : undefined)} />;
}

/**
 * The kingdom's arms painted from its crest record (`armsMarkup`, shared with the share image): field in the first
 * tincture, the charge in the second, a bordure in the third and a chief in the fourth when the arms supply them,
 * all washed and outlined in iron-gall. An approved painted asset is resolved by the host; until one is supplied
 * the record's own grammar is drawn.
 */
export function CrestArms(props: { crest: CrestView; kingdomName: string; size: number; class?: string; decorative?: boolean }): JSX.Element {
  const id = `ppa${createUniqueId()}`;
  return <svg class={`pp-arms${props.class ? ` ${props.class}` : ''}`} viewBox="0 0 100 110" width={props.size} height={props.size * 1.1}
    {...(props.decorative ? { 'aria-hidden': 'true' as const } : { role: 'img', 'aria-label': `Arms of ${props.kingdomName}: ${blazonOf(props.crest.shape, props.crest.charge)}` })}
    innerHTML={armsMarkup(props.crest, id)} />;
}
