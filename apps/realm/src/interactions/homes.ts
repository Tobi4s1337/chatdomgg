import type { PersonId } from '@chatdom/shared';
import type { CollisionWorld, RealmPrivateState } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { FoundedHomeBinding } from '../founded';
import { foundedInstalledHomes, homeThreshold, type HomeThreshold } from '../../../../packages/world/src/interactions';
import type { InteractionHomes } from './ports';

/*
 * Homes as the room actually holds them (spec 37 R7/R8): the committed deed in the private state says whose home a
 * plot is and at which revision; the founded scene says where that exact furnished blueprint stands. Doors are
 * derived from those two and the scene's own collision, never from a public slot, a name or a mesh.
 */

/**
 * The deed port from the room's committed private state. One person holds at most one deed in a kingdom
 * (allocation returns the existing one), so the owned plot is the home whose `ownerId` is that person, at the
 * kingdom's current layout. `revisionOf` is the installed revision on the plot right now, which a door derived from
 * an earlier scene must match.
 */
export function ownedHomes(state: () => Pick<RealmPrivateState, 'homes'>, layoutRevision?: () => string): Required<InteractionHomes> {
  return {
    ownedPlotId(personId: PersonId) {
      const layout = layoutRevision?.();
      const homes = Object.values(state().homes).filter(home => home.ownerId === personId && (layout === undefined || home.layoutRevision === layout));
      return homes.length === 1 ? homes[0]!.id : null;
    },
    revisionOf(plotId: string) {
      const homes = state().homes;
      return Object.hasOwn(homes, plotId) ? homes[plotId]!.revision : null;
    },
  };
}

export interface FoundedThresholds {
  /** One threshold per owned home whose installed blueprint stands on its plot in this scene. */
  readonly homes: readonly HomeThreshold[];
  /** Owned plots with no single installed home placement in the scene: no door is registered for them. */
  readonly missing: readonly string[];
}

/**
 * Thresholds for every owned home in an assembled founded scene (`assembleFoundedScene`'s `scene` and `homes`), at
 * the collision compiled from that same scene, each carrying the committed revision the scene was built from. A scene
 * compiled for another collision revision is refused outright rather than half-trusted.
 */
export function foundedHomeThresholds(build: {
  readonly scene: Pick<RealmFoundedScene, 'collisionRevision' | 'assets' | 'placements'>;
  readonly homes: readonly FoundedHomeBinding[];
}, world: CollisionWorld): FoundedThresholds {
  if (build.scene.collisionRevision !== world.revision) throw new Error(`The founded scene is for collision revision ${build.scene.collisionRevision}, not ${world.revision}.`);
  const revisions = new Map(build.homes.filter(h => h.source === 'owned').map(h => [h.plotId, h.revision ?? ''] as const));
  const installed = foundedInstalledHomes(build.scene, revisions);
  return { homes: installed.homes.map(home => homeThreshold(home, world)), missing: installed.missing };
}
