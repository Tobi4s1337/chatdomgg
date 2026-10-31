import { KingdomIdSchema, StyleIdSchema, VoxelBlueprintSchema, type KingdomId } from '../deps';
import type { ApprovedEmoteVisual, EmoteMask, EmoteMotifGeometry } from '../types';

const EMOTE_STYLE = StyleIdSchema.parse('emote');

/** A heraldry charge ready to compose into an existing banner or crest. */
export interface EmoteHeraldryGeometry extends EmoteMotifGeometry {
  /** The charge's front silhouette (x contiguous, Y up, 0 air) for cloth appliqué and painted crests. */
  charge: EmoteMask;
}

/**
 * The checked heraldry factory (Spec 24 R8). Only a visual approved for `heraldry` is accepted; a
 * statue or motif approval never stands in for it. Heraldry is static, so the first frame is chosen
 * explicitly. It returns the charge, not a finished crest: `blueprint` is the carved charge in its
 * own build cells (front +Z), `mount` is the centre of its back face, where a banner or crest owner
 * fixes it, and `charge` is the front silhouette for appliqué. The composed banner or crest is
 * reviewed again in its owner's publication flow. Returns null for anything it cannot honour.
 */
export function createEmoteHeraldry(visual: ApprovedEmoteVisual, kingdomId: KingdomId): EmoteHeraldryGeometry | null {
  if (!visual || visual.purpose !== 'heraldry' || !visual.frames?.length) return null;
  if (!KingdomIdSchema.safeParse(kingdomId).success) return null;
  const first = visual.frames[0]!.blueprint;
  const [w, h] = first.size;
  const { mask } = visual;
  if (mask.width !== w || mask.height !== h || mask.materialIds.length !== w * h) return null;
  const parsed = VoxelBlueprintSchema.safeParse({ ...first, id: `emote.heraldry.${visual.revision}`, styleId: EMOTE_STYLE, kind: 'prop', windows: [] });
  if (!parsed.success) return null;
  return {
    blueprint: parsed.data,
    mount: [w / 2, h / 2, 0],
    emitter: null,
    provenance: { emoteId: visual.id, revision: visual.revision, kingdomId, origin: visual.origin },
    charge: { width: mask.width, height: mask.height, materialIds: mask.materialIds.slice() },
  };
}
