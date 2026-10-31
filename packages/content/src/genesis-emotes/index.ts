import { MATERIALS } from '../materials';
import { carve } from './carve';
import type { EmoteCompileFailureCode } from './deps';
import { EMOTE_USES, matchEmoteWorks, type EmoteRefusal, type EmoteUse, type EmoteWork } from './derivatives';
import { composeEmoteGlass, composePlainGlass, type EmoteGlass } from './glass';
import { EMOTE_ART_KITS, GLASS_DYES, STATUE_PIGMENTS, VANE_METALS, type EmoteArtStyle, type LandscapeCharacter } from './kit';
import { composeMonument, type EmoteMonument } from './monument';
import { composeEmoteVane, type EmoteVane } from './vane';

export { derivativeRasterHash, EMOTE_USES, matchEmoteWorks, type ApprovedEmoteDerivative, type EmoteAssetReference, type EmoteRefusal, type EmoteUse, type EmoteWork, type EmoteWorkMatch } from './derivatives';
export { CAME, EMOTE_ART_KITS, GLASS_DYES, STATUE_PIGMENTS, VANE_METALS, type EmoteArtKit, type EmoteArtLantern, type EmoteArtStyle, type LandscapeCharacter } from './kit';
export { MONUMENT_CLEARANCE_CELLS, PEDESTAL_HEIGHT, type EmoteMonument } from './monument';
export type { EmoteGlass, EmoteGlassLight } from './glass';
export type { EmoteVane } from './vane';

/** How each use is carved: compiler profile, height and depth in build cells, and its closed palette. */
export const EMOTE_ART_PROFILES = {
  /** 5 m of painted stone, six cells deep with the compiler's bevel. */
  statue: { purpose: 'statue', height: 40, depth: 6, palette: STATUE_PIGMENTS },
  /** 1.75 m of gilded sheet, two cells thick. */
  weathervane: { purpose: 'motif', height: 14, depth: 2, palette: VANE_METALS },
  /** 3 m of glass; the front face becomes the panes. */
  'stained-glass': { purpose: 'heraldry', height: 24, depth: 2, palette: GLASS_DYES },
} as const;

/**
 * The part of a channel-genesis recipe this adapter reads. It is structurally the frozen `ChannelKingdomRecipe`
 * (`@chatdom/world/genesis`), so the real deep-readonly recipe is passed as it is. Approval references are matched,
 * never copied to the output; seeds, size and soul stay with the recipe.
 */
export interface EmoteArtRecipe {
  /** The full decimal broadcaster ID. Typed loosely because `DeepReadonly` maps the branded string to an object type. */
  readonly kingdomId: unknown;
  readonly evidence: { readonly kind: 'observed' | 'simulated' };
  readonly identity: { readonly styleFamily: EmoteArtStyle; readonly emoteWorks: readonly EmoteWork[] };
  readonly landscapes: readonly EmoteArtLandscape[];
}

export interface EmoteArtLandscape {
  readonly id: string;
  readonly character: LandscapeCharacter;
}

/** Why a use has no carving. Every reason composes as absence: no generic statue, glass or vane stands in. */
export type EmoteArtAbsence =
  | { readonly use: EmoteUse; readonly reason: 'none-approved' }
  | { readonly use: EmoteUse; readonly reason: 'derivative-missing' }
  | { readonly use: EmoteUse; readonly reason: 'refused'; readonly refusal: EmoteRefusal }
  | { readonly use: EmoteUse; readonly reason: 'uncarvable'; readonly code: EmoteCompileFailureCode };

/** A kingdom's emote art on its selected land. Public geometry only: no hashes, approval IDs or source lineage. */
export interface GenesisEmoteArt {
  readonly version: 'genesis-emote-art-1';
  readonly landscapeId: string;
  readonly character: LandscapeCharacter;
  readonly style: EmoteArtStyle;
  /** `SIMULATED` whenever the recipe's evidence is simulated: every view of this art must carry it. */
  readonly label: 'SIMULATED' | null;
  readonly monument: EmoteMonument | null;
  /** Always a window: the approved emote's, or plain quarries that claim nothing. */
  readonly glass: EmoteGlass;
  readonly vane: EmoteVane | null;
  readonly absences: readonly EmoteArtAbsence[];
  /** Every registered material the pieces carve, ascending, and the registry revision they were carved against. */
  readonly palette: { readonly revision: number; readonly materials: readonly number[] };
}

/**
 * Composes a recipe's emote art on the landscape the monarch selected. Each use is matched to the derivative
 * supplied for exactly that emote and use (see `matchEmoteWorks`); a refused or missing one is reported as
 * absence. Simulated recipes take only simulated derivatives and observed recipes only live ones. Pure and
 * deterministic: no clock, randomness, network or I/O, and every call returns fresh objects.
 */
export function composeGenesisEmoteArt(recipe: EmoteArtRecipe, landscape: EmoteArtLandscape, derivatives: readonly unknown[]): GenesisEmoteArt {
  const style = recipe.identity.styleFamily;
  const kit = EMOTE_ART_KITS[style];
  if (!Object.hasOwn(EMOTE_ART_KITS, style) || !kit) throw new Error(`No emote art kit for style family "${String(style)}".`);
  const matches = recipe.landscapes.filter(candidate => candidate.id === landscape.id);
  if (matches.length !== 1 || matches[0]!.character !== landscape.character) throw new Error(`Landscape "${landscape.id}" is not one of this recipe's candidates.`);
  const { character } = landscape;
  if (typeof recipe.kingdomId !== 'string') throw new Error('The recipe has no kingdom ID.');
  const origin = recipe.evidence.kind === 'simulated' ? 'simulated' : 'live';

  const absences: EmoteArtAbsence[] = [];
  let monument: EmoteMonument | null = null, glass: EmoteGlass | null = null, vane: EmoteVane | null = null;
  for (const use of EMOTE_USES) {
    const works = recipe.identity.emoteWorks.filter(work => work.use === use);
    if (!works.length) { absences.push({ use, reason: 'none-approved' }); continue; }
    if (works.length > 1) { absences.push({ use, reason: 'refused', refusal: 'ambiguous' }); continue; }
    const match = matchEmoteWorks(works, derivatives, { broadcasterId: recipe.kingdomId as string, origin })[0]!;
    if (match.kind === 'missing') { absences.push({ use, reason: 'derivative-missing' }); continue; }
    if (match.kind === 'refused') { absences.push({ use, reason: 'refused', refusal: match.refusal }); continue; }
    const profile = EMOTE_ART_PROFILES[use];
    const carved = carve(match.derivative, profile.purpose, profile.palette, profile.height, profile.depth);
    if (!carved.ok) { absences.push({ use, reason: 'uncarvable', code: carved.code }); continue; }
    if (use === 'statue') monument = composeMonument(kit, character, carved.emote, carved.size);
    else if (use === 'stained-glass') glass = composeEmoteGlass(kit, carved.emote);
    else vane = composeEmoteVane(kit, carved.emote);
  }
  glass ??= composePlainGlass(kit);

  const used = new Set<number>();
  const pieces = [
    ...(monument ? [monument.pedestal, ...monument.frames.map(frame => frame.blueprint)] : []),
    glass.blueprint, ...(vane ? [vane.mast, vane.rotor] : []),
  ];
  for (const piece of pieces) for (const box of piece.boxes) if (box.material !== 0) used.add(box.material);
  return {
    version: 'genesis-emote-art-1', landscapeId: landscape.id, character, style,
    label: origin === 'simulated' ? 'SIMULATED' : null,
    monument, glass, vane, absences,
    palette: { revision: MATERIALS.revision, materials: [...used].sort((a, b) => a - b) },
  };
}
