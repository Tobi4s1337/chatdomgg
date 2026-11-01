import type { Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type SettlementPlan, type XZ } from '@chatdom/world';
import { sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { RoyalBrazier } from '../../kingdom/royal-life';
import type { Dressing } from '../../kingdom/settlement-content';
import { unit } from '../holding-facts';
import { createLighthouse } from './pieces/lighthouse/lighthouse';
import { createWatchtower } from './pieces/watchtower/watchtower';
import { createWindmill } from './pieces/mill/mill';
import type { GeneratedPiece, PieceOptions } from './pieces';
import { CELL, facing, stand, type Footprint, type Ground } from './site';

export type SkylineKind = 'lighthouse' | 'watchtower' | 'windmill';

/** A tall piece the town is seen by from afar, and the way its front faces in world XZ. */
export interface SkylinePiece {
  readonly kind: SkylineKind;
  readonly at: Vec3;
  readonly height: number;
  readonly front: readonly [number, number];
}

interface Context {
  readonly ground: Ground;
  readonly plan: SettlementPlan;
  readonly landscape: DeepReadonly<GenesisLandscape>;
  readonly recipe: DeepReadonly<ChannelKingdomRecipe>;
  readonly market: XZ;
  readonly castle: XZ;
  readonly options: PieceOptions;
}

/**
 * The town's skyline beyond its keep: what a traveller sees first from the road. The realm's own tall landmark
 * stands where it belongs (the lighthouse on the shore nearest the town, the lookout on the highest gentle ground
 * at the town's edge, the mill on an open rise away from the castle), and a farming land often has a mill even when
 * its realm has another landmark. A piece that finds no dry, gentle, unclaimed site inside the drawn land is left out.
 */
export function placeSkyline(context: Context): { props: Dressing[]; braziers: RoyalBrazier[]; pieces: SkylinePiece[] } {
  const { recipe, landscape } = context;
  const props: Dressing[] = [], braziers: RoyalBrazier[] = [], pieces: SkylinePiece[] = [];
  const family = recipe.identity.landmark;
  const wanted: SkylineKind[] = [];
  if (family === 'lighthouse') wanted.push('lighthouse');
  // On a harbour the keep is itself the watchtower.
  if (family === 'watchtower' && landscape.character !== 'coastal-harbour') wanted.push('watchtower');
  if (family === 'watermill') wanted.push('windmill');
  const farmland = landscape.character === 'river-valley' || recipe.identity.biome === 'meadow';
  if (!wanted.includes('windmill') && farmland && recipe.size.homeCapacity >= 48 && unit(`${recipe.seedKey}/skyline/windmill`) < .4) wanted.push('windmill');

  for (const kind of wanted) {
    let piece = make(kind, context.options);
    let site = findSite(context, kind, piece);
    // A lighthouse with no shore near enough keeps its light as a beacon tower on the heights.
    if (!site && kind === 'lighthouse') { piece = make('watchtower', context.options); site = findSite(context, 'watchtower', piece); }
    if (!site) continue;
    const [fx0, fz0] = piece.footprint.from, [fx1, fz1] = piece.footprint.to;
    const placed = stand(context.ground, piece.blueprint, [(fx0 + fx1) / 2, (fz0 + fz1) / 2], site.centre, site.turn, { footprint: piece.footprint, lanterns: piece.lanterns, sink: CELL });
    props.push(placed.dressing);
    braziers.push(...placed.braziers);
    context.ground.claim(site);
    const front = transformCardinalPoint([0, 0, 0], site.turn, [0, 0, 1]);
    pieces.push({ kind: site.kind, at: [site.centre[0], placed.origin[1], site.centre[1]], height: piece.blueprint.size[1] * CELL, front: [front[0], front[2]] });
  }
  return { props, braziers, pieces };
}

function make(kind: SkylineKind, options: PieceOptions): GeneratedPiece {
  return kind === 'lighthouse' ? createLighthouse(options) : kind === 'watchtower' ? createWatchtower(options) : createWindmill(options);
}

/**
 * Candidate sites on a six-metre grid inside the drawn land, scored for the piece, tried best first. Deterministic.
 */
function findSite(context: Context, kind: SkylineKind, piece: GeneratedPiece): (Footprint & { kind: SkylineKind }) | null {
  const { ground, plan, landscape, market, castle } = context;
  const [fx0, fz0] = piece.footprint.from, [fx1, fz1] = piece.footprint.to;
  const half: [number, number] = [(fx1 - fx0) * CELL / 2 + .5, (fz1 - fz0) * CELL / 2 + .5];
  const inset = Math.max(half[0], half[1]) + 6;
  const near = kind === 'lighthouse' ? [40, 260] : kind === 'watchtower' ? [45, 210] : [55, 240];
  const marketHeight = plan.market.elevation;
  const scored: { centre: XZ; score: number }[] = [];
  for (let x = plan.bounds.minX + inset; x <= plan.bounds.maxX - inset; x += 6) {
    for (let z = plan.bounds.minZ + inset; z <= plan.bounds.maxZ - inset; z += 6) {
      const d = Math.hypot(x - market[0], z - market[1]);
      if (d < near[0]! || d > near[1]!) continue;
      const s = sampleGenesisSurface(landscape, x, z);
      if (s.water) continue;
      const h = ground.height(x, z);
      let score: number;
      if (kind === 'lighthouse') {
        // On the sea's very edge: dry, but with open ocean a short way off on some side.
        if (s.shoreDistance < 3 || s.shoreDistance > 18 || !seaward(landscape, x, z)) continue;
        score = -d * .06 + Math.min(h, 12) * .5;
      } else if (kind === 'watchtower') {
        score = (h - marketHeight) * 1 - d * .06;
      } else {
        const fromCastle = Math.hypot(x - castle[0], z - castle[1]);
        score = (h - marketHeight) * .8 - d * .045 + Math.min(fromCastle, 200) * .03;
      }
      scored.push({ centre: [x, z], score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.centre[0] - b.centre[0] || a.centre[1] - b.centre[1]);
  for (const candidate of scored) {
    const turn = facing(candidate.centre, market);
    const site: Footprint = { centre: candidate.centre, half, turn };
    if (ground.free(site, { rise: kind === 'lighthouse' ? 3 : 2.5, margin: 2 })) return { ...site, kind };
  }
  return null;
}

/** Open sea within twenty-four metres in one of eight directions. */
function seaward(landscape: DeepReadonly<GenesisLandscape>, x: number, z: number): boolean {
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    if (sampleGenesisSurface(landscape, x + Math.cos(a) * 24, z + Math.sin(a) * 24).water === 'ocean') return true;
  }
  return false;
}
