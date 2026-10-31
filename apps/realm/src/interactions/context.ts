import type { PersonId, Vec3 } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, RealmInteractionAction, RealmInteractionContext } from '@chatdom/shared/realm';
import { standingClear, withinReach, type InteractionRecord, type InteractionRegistry } from '../../../../packages/world/src/interactions';

/**
 * Builds the trusted `RealmInteractionContext` from authoritative inputs only: the room's current walker, its
 * collision world, the registry for that revision, the deed and the rights the room holds. The intent supplies
 * nothing but a target ID and an action, and `stand` ignores even the ID in favour of one's own leased seat.
 *
 * `target` is null when the ID is unknown, the registry or the walker belongs to another collision revision, or
 * `stand` has no seat to address. `unobstructed` means: within reach with a clear line from the eye, and the
 * approach (and a door/exit's far threshold) supported and full-body clear at `collisionRevision`.
 */
export function buildInteractionContext(input: {
  readonly personId: PersonId; readonly sessionId: string; readonly walkerId: string; readonly writerEpoch: string; readonly now: number;
  readonly walker: Readonly<PlayerState>; readonly world: CollisionWorld; readonly registry: InteractionRegistry;
  readonly ownedPlotId: string | null; readonly permitted: boolean;
  readonly targetId: string; readonly action: RealmInteractionAction;
  /** The target of this session's current seat lease, if any. */
  readonly leasedTargetId: string | null;
}): RealmInteractionContext {
  const { walker, world, registry } = input;
  const position: Vec3 = [walker.x, walker.y, walker.z];
  const current = world.revision === registry.collisionRevision && walker.collisionRevision === world.revision;
  const record = !current ? undefined : input.action === 'stand' ? (input.leasedTargetId ? registry.get(input.leasedTargetId) : undefined) : registry.get(input.targetId);
  return {
    personId: input.personId, sessionId: input.sessionId, walkerId: input.walkerId, writerEpoch: input.writerEpoch, now: input.now,
    position, collisionRevision: world.revision, ownedPlotId: input.ownedPlotId,
    target: record?.target ?? null,
    unobstructed: !!record && physicallyReady(world, position, record, input.action),
    permitted: input.permitted,
  };
}

function physicallyReady(world: CollisionWorld, feet: Vec3, record: InteractionRecord, action: RealmInteractionAction): boolean {
  // Standing up happens from the seat itself; the question is only whether the approach is still a safe place.
  if (action === 'stand') return standingClear(world, record.target.approach);
  if (!withinReach(world, feet, record.target) || !standingClear(world, record.target.approach)) return false;
  return record.target.kind === 'home-door' || record.target.kind === 'home-exit' ? !!record.rest && standingClear(world, record.rest) : true;
}
