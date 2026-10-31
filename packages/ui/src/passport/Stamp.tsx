import { createUniqueId, type JSX } from 'solid-js';
import { stampMarkup } from './markup';
import type { StampView } from './types';

/**
 * One kingdom's stamp, pressed by hand (`stampMarkup` draws it, the same lines the share image uses). The frame
 * follows the arms' own shape and carries the charge in the arms' darkest tincture; a raid adds a wax seal poured
 * from the arms' strongest colour, pressed with the charge and a thumb. Everything about where and how it landed
 * comes from the record ID. The stamp is decoration: its caption beside it carries every fact in text.
 */
export function PassportStampMark(props: { stamp: StampView; size: number; class?: string }): JSX.Element {
  const id = `pps${createUniqueId()}`;
  return <svg class={`pp-stamp${props.class ? ` ${props.class}` : ''}`} data-kind={props.stamp.kind} data-shape={props.stamp.kingdom.crest.shape}
    viewBox="0 0 160 160" width={props.size} height={props.size} aria-hidden="true" innerHTML={stampMarkup(props.stamp, id)} />;
}
