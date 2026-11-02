import type { CitizenLook } from '../../../../packages/content/src/avatar-style';
import { TABS, type Control, type Swatch, type TileOption } from './catalogue';

/*
 * The mirror's three quick picks, from the builder's own catalogue so they are exactly the accepted pieces: a few
 * haircuts, the tops, and the colour of the top. What you already wear is always the first choice.
 */

type Tiles = Extract<Control, { kind: 'tiles' }>;
type Swatches = Extract<Control, { kind: 'swatches' }>;

const control = <K extends Control['kind']>(id: string, kind: K): Extract<Control, { kind: K }> => {
  for (const tab of TABS) for (const c of tab.controls) if (c.id === id && c.kind === kind) return c as Extract<Control, { kind: K }>;
  throw new Error(`The catalogue has no ${kind} ${id}.`);
};

/** A spread of cuts that reads apart at a glance: short, curly, long, tied, big. */
const HAIR_SPREAD = ['short-crop', 'curls', 'bob', 'long-waves', 'ponytail', 'buns', 'afro', 'spiky', 'braids', 'quiff'];
const COLOUR_SPREAD = ['tomato', 'orange', 'yellow', 'leaf', 'teal', 'sky', 'cobalt', 'purple', 'pink', 'white', 'charcoal', 'sand'];

export interface MirrorPicks {
  readonly hair: Tiles;
  readonly hairs: readonly TileOption[];
  readonly top: Tiles;
  readonly tops: readonly TileOption[];
  readonly colour: Swatches;
  readonly colours: readonly Swatch[];
}

export function mirrorPicks(look: CitizenLook, hairCount = 8): MirrorPicks {
  const hair = control('hair', 'tiles'), top = control('top', 'tiles'), colour = control('top-dye', 'swatches');
  const current = hair.options.find(o => o.selected(look));
  const spread = HAIR_SPREAD.map(id => hair.options.find(o => o.id === id)).filter((o): o is TileOption => !!o && o !== current);
  const hairs = [...(current ? [current] : []), ...spread].slice(0, hairCount);
  const all = colour.groups.flatMap(g => g.swatches);
  const wearing = all.find(s => s.hex === colour.get(look));
  const colours = [...(wearing ? [wearing] : []), ...COLOUR_SPREAD.map(id => all.find(s => s.id === id)).filter((s): s is Swatch => !!s && s !== wearing)].slice(0, 12);
  return { hair, hairs, top, tops: top.options, colour, colours };
}
