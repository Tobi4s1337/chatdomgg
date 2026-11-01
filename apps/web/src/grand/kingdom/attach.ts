import type * as THREE from 'three';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { frameSettlement, type SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import { createGenesisWindowPreview } from '../../genesis/window-preview';
import { createSimulatedPresence, type SimulatedPresence } from '../../kingdom/presence-feed';
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
  /** What the windows show and where it came from: a potential kingdom's SIMULATED light study, or null when the
   * windows follow the citizens' own SIMULATED producer. */
  readonly presence: KingdomPresenceFrame | null;
  /** The labelled SIMULATED producer the citizens of a SIMULATED kingdom walk by. Null for a potential kingdom. */
  readonly simulation: SimulatedPresence | null;
  readonly placements: readonly KingdomPlacement[];
}

/**
 * Draw the kingdom on its seated land: every exact piece at the seat's translation, lit by the land's hour.
 * - A SIMULATED kingdom (tobi4s_'s Willowmere with no adopted bytes read) gets today's citizens, walking home on its
 *   streets by the kingdom view's own labelled SIMULATED producer, and its windows light as they arrive.
 * - A potential kingdom has no citizens: its windows are the Genesis view's SIMULATED light study, nobody walks.
 * No presence is read here, and the grand view never invents people beyond what those labelled producers show.
 * Returns null when the land was raised without the settlement.
 */
export function attachGrandKingdom(engine: GrandKingdomEngine, kingdom: GrandKingdomContent, extra: readonly KingdomPlacement[] = []): GrandKingdomAttachment | null {
  const seated = engine.seated;
  if (!seated) return null;
  const kingdomId = KingdomIdSchema.parse(kingdom.kingdomId);
  const asOf = kingdom.recipe?.evidence.asOf ?? Date.UTC(2026, 9, 31);
  const simulation = kingdom.evidence === 'simulated' && kingdom.plan.homes.length ? createSimulatedPresence(kingdom.plan) : null;
  const presence = simulation ? null : createGenesisWindowPreview(kingdomId, kingdom.plan.homes, asOf);
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
    ...(simulation ? { citizens: { plan: kingdom.plan, simulation } } : {}),
  });
  engine.addLayer(layer);
  return { layer, presence, simulation, placements };
}
