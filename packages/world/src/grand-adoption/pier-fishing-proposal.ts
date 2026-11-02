import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint } from '../settlement/geometry';
import type { CardinalTurn } from '../settlement/types';
import type { LandGroundAt } from '../land-interface';
import type { AuthoredPierPiece, AuthoredPierProposal } from './pier-authored-types';
import type { PierAnchor } from './pier-sites-types';

/** Structural input from the fishing producer; no dependency on a second app's private realm module. */
export interface FishingPierGeometry {
  readonly version: 1; readonly id: string; readonly root: Vec3; readonly turn: CardinalTurn;
  readonly deckY: number; readonly waterY: number; readonly walk: number; readonly water: PierAnchor['water'];
}

/** Map the authored fishing pier's frame (build cells, walk X=0..20) into settlement metres. This supplies
 * validation intent, never permission to install. The validator derives occupied bounds and walking solids
 * from the exact supplied blueprints, including the gateway, T-head, rails and furnishings. */
export function createFishingPierProposal(input: {
  readonly site: FishingPierGeometry; readonly pieces: readonly AuthoredPierPiece[];
  /** Actual content.anchors.fishing, in the producer's build-cell frame relative to the deck datum. */
  readonly fishing: readonly Vec3[];
  readonly groundAt: LandGroundAt;
  /** Explicit founded/recipe biome; a landform character or fallback string cannot supply this. */
  readonly biome: string;
}): AuthoredPierProposal | null {
  const { site, pieces } = input, unit = VOXEL_METRES.build;
  const head = pieces.find(piece => piece.id === `${site.id}:head`);
  if (!head || head.blueprint.lattice !== 'build' || !input.biome.trim() || !input.fishing.length) return null;
  const at = (x: number, y: number, z: number): Vec3 => transformCardinalPoint([site.root[0], y, site.root[2]], site.turn, [x, 0, z]);
  const bank = at(0, site.root[1], -2), entry = input.groundAt(bank[0], bank[2]);
  if (!entry) return null;
  const width = head.blueprint.size[0] * unit, depth = head.blueprint.size[2] * unit;
  const headCentre = at(0, site.deckY, site.walk + depth / 2);
  return {
    version: 1,
    anchor: { id: site.id, root: site.root, turn: site.turn, waterY: site.waterY, water: site.water, biome: input.biome },
    deckY: site.deckY, walkLength: site.walk, head: { pieceId: head.id, width, depth }, pieces, entry,
    route: [entry, at(0, site.deckY, 0), headCentre],
    fishing: input.fishing.map((local, index) => {
      const x = (local[0] - 10) * unit;
      const position = at(x, site.deckY + local[1] * unit, local[2] * unit);
      const a = at(x - .35, site.waterY, site.walk + depth + 2);
      const b = at(x + .35, site.waterY, site.walk + depth + 7);
      return { id: `${site.id}:fishing:${index}`, position, route: [headCentre, position],
        castArea: { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) } };
    }),
  };
}
