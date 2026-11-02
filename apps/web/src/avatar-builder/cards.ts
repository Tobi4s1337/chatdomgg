import {
  BRASS, METALS, RIBBON_COLOURS, earnedOffers, pinGlyph, ribbonMarks, wearPiece, wornPieces,
  type CitizenEntitlements, type CitizenLook, type EarnedOffer, type EarnedPiece,
} from '../../../../packages/content/src/avatar-style';
import type { Control, TileOption, TileView } from './catalogue';
import { pieceCardFor } from './pieces';
import type { FocusRegion } from './turntable';

/*
 * The card each piece is shown with: its name, the line that tells its story, its tier (free for everyone, just for
 * fun, or earned) and, for an earned piece, how it is earned and how far along you are. Cards come from the content
 * package's piece cards and the earned offers, never from words made up here.
 */

export type CardTier = 'base' | 'fun' | 'earned';

export interface BuilderCard {
  /** Stable: `<kind>:<id>` for a piece, the offer's key for an earned piece, `<control>:<option>` for other choices. */
  readonly key: string;
  readonly name: string;
  /** The part of you it is (Hair, Hat, Earned · Pins). */
  readonly part: string;
  readonly story: string | null;
  readonly tier: CardTier;
  /** New in the wardrobe and not yet tried on this device. */
  readonly isNew: boolean;
  readonly region: FocusRegion | null;
  readonly earned?: {
    readonly unlocked: boolean;
    readonly worn: boolean;
    readonly how: string;
    readonly progress: EarnedOffer['progress'];
    readonly dim: boolean;
  };
  /** Shown large on the card: the picture's view, and for pins and ribbons the badge itself. */
  readonly view: TileView;
  readonly emblem: Emblem | null;
}

export const TIER_WORDS: Readonly<Record<CardTier, string>> = { base: 'Free for everyone', fun: 'Just for fun', earned: 'Earned' };

/** The card for a tile. `seen` holds the piece keys this device has already tried on. */
export function tileCard(control: Extract<Control, { kind: 'tiles' }>, option: TileOption, seen: ReadonlySet<string>): BuilderCard {
  const piece = control.piece && option.id !== 'none' ? pieceCardFor(control.piece, option.id) : null;
  const key = piece ? `${piece.kind}:${piece.id}` : `${control.id}:${option.id}`;
  return {
    key, name: piece?.name ?? option.label, part: control.label, story: piece?.story ?? null,
    tier: piece?.tier ?? 'base', isNew: !!piece?.isNew && !seen.has(key), region: control.region, view: control.view, emblem: null,
  };
}

/** Where an earned piece is worn: the turntable leans in there, and its picture is taken from there. */
export function earnedRegion(piece: EarnedPiece): FocusRegion {
  switch (piece.family) {
    case 'ribbons': case 'pin': return 'badge';
    case 'hood': case 'scarf': return 'chest';
    case 'cape': return 'back';
    case 'forgedHat': return 'head';
  }
}
export function earnedView(piece: EarnedPiece): TileView {
  switch (piece.family) {
    case 'cape': return 'back';
    case 'hood': return 'nape';
    case 'forgedHat': return 'bust';
    default: return 'chest';
  }
}

export const EARNED_GROUPS = ['Tenure', 'Pins', 'Moments and the Forge', 'Sub pieces'] as const;
export type EarnedGroup = typeof EARNED_GROUPS[number];
export const GROUP_NOTES: Readonly<Record<EarnedGroup, string>> = {
  Tenure: 'From showing up. Bound to this kingdom.',
  Pins: 'Two at a time. Keepsakes travel with you.',
  'Moments and the Forge': 'Everyone who was there gets the same piece.',
  'Sub pieces': 'Shown on Twitch. They dim when a sub lapses, never vanish.',
};
export function earnedGroup(offer: EarnedOffer): EarnedGroup {
  const family = offer.piece.family;
  return family === 'ribbons' || family === 'hood' ? 'Tenure'
    : family === 'pin' ? 'Pins'
      : family === 'cape' && offer.piece.value.kind !== 'cheer' ? 'Sub pieces' : 'Moments and the Forge';
}

export function earnedCard(offer: EarnedOffer, worn: boolean): BuilderCard {
  return {
    key: offer.key, name: offer.name, part: `Earned · ${earnedGroup(offer)}`,
    story: offer.unlocked ? offer.story : null, tier: 'earned', isNew: false,
    region: earnedRegion(offer.piece), view: earnedView(offer.piece), emblem: emblemFor(offer.piece),
    earned: { unlocked: offer.unlocked, worn, how: offer.earnedBy, progress: offer.progress, dim: offer.dim },
  };
}

/**
 * A badge drawn large from the very cells the citizen wears: a pin's three-by-three glyph in its colours and metal,
 * or the ribbon bar's two marks. On the chest they are one or two voxels; on the card they read at a glance.
 */
export interface Emblem {
  readonly kind: 'pin' | 'ribbons';
  readonly width: number;
  readonly height: number;
  readonly cells: readonly { readonly x: number; readonly y: number; readonly colour: string }[];
  /** The words under the badge: "38 months", "Founder". */
  readonly caption: string | null;
}

export function emblemFor(piece: EarnedPiece): Emblem | null {
  if (piece.family === 'ribbons') {
    const marks = ribbonMarks(piece.value.months);
    const colours = [0, 1].map(i => RIBBON_COLOURS[marks[Math.min(i, marks.length - 1)]!]);
    return { kind: 'ribbons', width: 2, height: 1, cells: colours.map((colour, x) => ({ x, y: 0, colour })), caption: `${piece.value.months} ${piece.value.months === 1 ? 'month' : 'months'}` };
  }
  if (piece.family !== 'pin') return null;
  const pin = piece.value;
  const [a, b, m] = pin.kind === 'founder' ? [BRASS, '#fbf6ea', BRASS] : [pin.colours[0], pin.colours[1], pin.kind === 'forged' ? METALS[0].hex : BRASS];
  const cells: { x: number; y: number; colour: string }[] = [];
  pinGlyph(pin).forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') cells.push({ x, y, colour: c === 'a' ? a : c === 'b' ? b : m });
  }));
  return { kind: 'pin', width: 3, height: 3, cells, caption: pin.kind === 'founder' ? 'Founder' : null };
}

/**
 * Earned marks survive tenure updates: a look saved with the 3-month ribbons, worn by someone now at 6 months, wears
 * the 6-month ribbons; a hood or sub cape follows its kingdom's colours. Only the same piece, grown, is replaced, never
 * a piece the records do not hold. The draft takes the result, so the person sees it and saves it.
 */
export function freshenEarned(look: CitizenLook, entitlements: CitizenEntitlements): CitizenLook {
  const offers = earnedOffers(entitlements).filter(offer => offer.unlocked);
  let out = look;
  for (const worn of wornPieces(look)) {
    const grown = offers.find(offer => {
      const piece = offer.piece;
      if (piece.family !== worn.family) return false;
      if (piece.family === 'ribbons' || piece.family === 'hood') return true;
      if (piece.family === 'cape' && worn.family === 'cape') return piece.value.kind === worn.value.kind && piece.value.id === worn.value.id && piece.value.kind !== 'cheer';
      return false;
    });
    if (grown && JSON.stringify(grown.piece) !== JSON.stringify(worn)) out = wearPiece(out, grown.piece);
  }
  return out;
}
