import * as THREE from 'three';
import { createLandMist, type LandMist } from '../../../../../packages/render/src/grand/mist';
import type { BakedSurface } from '../../../../../packages/world/src/grand/baked/types';
import type { GrandSeat } from '../../../../../packages/world/src/grand/kingdom/types';
import {
  GRAND_REVEAL_STAGES, grandRevealField, grandRevealMask, grandRevealOpening, grandRevealStage, type GrandRevealOpening,
} from '../../../../../packages/world/src/grand/reveal';
import { GRAND_VOXEL_METRES } from '../../../../../packages/world/src/grand/types';
import type { PlaceShot } from '../../interactions/places/framing';

const M = GRAND_VOXEL_METRES;
/** Seconds the mist takes to roll back off newly opened land, and how long the director holds the opening. */
export const KINGDOM_REVEAL_LIFT = 9;
const BEAT_SECONDS = 12;

/**
 * The stage each kingdom was last drawn at in this tab. A kingdom's scene is rebuilt when its plan grows; when the
 * new count crosses a milestone the next scene lifts the mist from the stage this tab last saw instead of laying the
 * new one at once, so the opening happens on screen. A first visit lays its stage without ceremony.
 */
const drawnStage = new Map<string, number>();

export interface KingdomRevealOpening extends GrandRevealOpening {
  /** The opening in settlement metres: where the lifted land lies, for a director shot. */
  readonly shot: PlaceShot;
  /** True when this scene lifts the mist (a crossing seen in this tab), false when it only lays it. */
  readonly lifting: boolean;
}

export interface KingdomReveal {
  /** The mist's uniforms, shared by the hosted floor and the water of a kingdom on its own world. */
  readonly mist: LandMist;
  /** Lay the mist for the founded land and its citizen count. Returns the newest opening (null at the founding). */
  lay(surface: BakedSurface, seat: GrandSeat, citizens: number): KingdomRevealOpening | null;
  readonly opening: KingdomRevealOpening | null;
  /** Advance the drift and any lift with this frame's air. While the opening is being shown, returns its shot. */
  update(seconds: number, air: { readonly fog: string; readonly sun: string; readonly night: number }): PlaceShot | null;
  inspect(): { readonly stage: number; readonly citizens: number; readonly lifting: boolean; readonly opened: number };
  dispose(): void;
}

/**
 * The opening of a kingdom's own world (GW13). The whole land is baked at the founding; this decides only how much
 * of it lies under the sea mist, as a pure function of the baked surface, the founded town's columns and the
 * citizen count. It never moves a home, a road or a forged piece, and it never closes land already open.
 */
export function createKingdomReveal(kingdomId: string): KingdomReveal {
  const mist = createLandMist();
  const fog = new THREE.Color(), sun = new THREE.Color();
  let opening: KingdomRevealOpening | null = null, stage = -1, count = 0, beat = 0, opened = 0;
  return {
    mist,
    get opening() { return opening; },
    lay(surface, seat, citizens) {
      if (!Number.isFinite(citizens) || citizens < 0) throw new RangeError('A kingdom opens by a real citizen count');
      const c = seat.columns;
      // The founded town and its blend band are the land the kingdom already lives on: clear from the first day.
      const field = grandRevealField(surface, {
        x0: Math.max(0, c.x0 - seat.band), z0: Math.max(0, c.z0 - seat.band),
        x1: Math.min(surface.size, c.x1 + seat.band), z1: Math.min(surface.size, c.z1 + seat.band),
      });
      count = Math.floor(citizens);
      stage = grandRevealStage(count);
      const seen = drawnStage.get(kingdomId);
      const lifting = seen !== undefined && seen < stage;
      const metres = surface.size * M;
      // Settlement metres + seat offset = land metres.
      const rect = [-seat.offset[0], -seat.offset[2], metres, metres] as const;
      if (lifting) mist.set(grandRevealMask(field, seen), field.cells, rect, seen === GRAND_REVEAL_STAGES - 1 ? 1 : 0);
      mist.set(grandRevealMask(field, stage), field.cells, rect, stage === GRAND_REVEAL_STAGES - 1 ? 1 : 0, lifting ? KINGDOM_REVEAL_LIFT : undefined);
      // The cloud deck three fifths of the way from the sea to the land's crown: valleys sink into it, the crowns stand out.
      let crown = surface.seaLevel;
      for (let i = 0; i < surface.ground.length; i += 7) if (surface.ground[i]! > crown) crown = surface.ground[i]!;
      mist.setDeck((surface.seaLevel + (crown - surface.seaLevel) * 0.6) * M - seat.offset[1]);
      drawnStage.set(kingdomId, Math.max(seen ?? -1, stage));
      if (stage === 0) { opening = null; opened = 0; return null; }
      const raw = grandRevealOpening(field, stage);
      opened = raw.opened;
      const at: [number, number, number] = [raw.focus[0] * M - seat.offset[0], (surface.seaLevel * M - seat.offset[1]) + 8, raw.focus[1] * M - seat.offset[2]];
      // Look at the lifting land from over the town, high enough to see it come out of the cloud.
      const town: [number, number] = [((c.x0 + c.x1) / 2) * M - seat.offset[0], ((c.z0 + c.z1) / 2) * M - seat.offset[2]];
      const dx = at[0] - town[0], dz = at[2] - town[1], reach = Math.max(80, Math.hypot(dx, dz));
      const eye: [number, number, number] = [town[0] - dx / reach * 40, at[1] + reach * 0.42 + 40, town[1] - dz / reach * 40];
      opening = { ...raw, shot: { eye, at }, lifting };
      beat = lifting ? BEAT_SECONDS : 0;
      return opening;
    },
    update(seconds, air) {
      mist.update(seconds, { fog: fog.set(air.fog), sun: sun.set(air.sun), night: air.night });
      if (beat <= 0 || !opening) return null;
      beat = Math.max(0, beat - Math.max(0, seconds));
      return beat > 0 ? opening.shot : null;
    },
    inspect: () => ({ stage, citizens: count, lifting: mist.lifting, opened }),
    dispose() { mist.dispose(); },
  };
}
