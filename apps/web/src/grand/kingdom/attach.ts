import type * as THREE from 'three';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { frameSettlement, type SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import { createGenesisWindowPreview } from '../../genesis/window-preview';
import { mountGrandKingdom, type GrandKingdomLayer, type KingdomPlacement } from './mount';
import type { GrandKingdomContent } from './pieces';

/** The part of the grand engine the kingdom attaches to. */
export interface GrandKingdomEngine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Set by the land worker once the settlement is seated on the raised land. */
  readonly seated: SeatedKingdom | null;
  invalidate(): void;
  addLayer(layer: GrandKingdomLayer): void;
}

export interface GrandKingdomAttachment {
  readonly layer: GrandKingdomLayer;
  /** What the windows show and where it came from; a potential kingdom is a SIMULATED light study. */
  readonly presence: KingdomPresenceFrame;
  readonly placements: readonly KingdomPlacement[];
}

/**
 * Draw the kingdom on its seated land: every exact piece at the seat's translation, the citizen windows lit by a
 * labelled SIMULATED study (no presence is read here; the grand view never invents people), lit by the land's hour.
 * Returns null when the land was raised without the settlement.
 */
export function attachGrandKingdom(engine: GrandKingdomEngine, kingdom: GrandKingdomContent, extra: readonly KingdomPlacement[] = []): GrandKingdomAttachment | null {
  const seated = engine.seated;
  if (!seated) return null;
  const kingdomId = KingdomIdSchema.parse(kingdom.kingdomId);
  const asOf = kingdom.recipe?.evidence.asOf ?? Date.UTC(2026, 9, 31);
  const presence = createGenesisWindowPreview(kingdomId, kingdom.plan.homes, asOf);
  // Groves planted past the physical region stood on the old small world's horizon; out there the grand land is
  // scenery with its own forests, so only what stands on the installed ground comes along.
  const r = frameSettlement(kingdom.plan).region, inside = (p: readonly number[]) => p[0]! > r.minX + 1 && p[0]! < r.maxX - 1 && p[2]! > r.minZ + 1 && p[2]! < r.maxZ - 1;
  const placements: KingdomPlacement[] = [
    ...kingdom.pieces.filter(piece => piece.role === 'home' || inside(piece.position)).map(piece => {
      if (!piece.assetHash) throw new Error(`${piece.id} has no asset identity; compose the kingdom through composeGrandKingdom.`);
      return { id: piece.id, blueprint: piece.blueprint, position: piece.position, yaw: piece.yaw, assetHash: piece.assetHash, ...(piece.slot !== undefined ? { slot: piece.slot } : {}) };
    }),
    ...extra,
  ];
  const layer = mountGrandKingdom({ scene: engine.scene, camera: engine.camera, invalidate: () => engine.invalidate() }, {
    offset: seated.seat.offset, placements, houses: kingdom.houses, presence,
    fires: [...kingdom.braziers, ...kingdom.forgeFires].map(fire => fire.position),
    ...(kingdom.founded ? { materials: kingdom.founded.materials } : {}),
  });
  engine.addLayer(layer);
  return { layer, presence, placements };
}
