import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { InteractionRecord } from '../../../../../packages/world/src/interactions';
import { tavernSeatOf } from '../../../../../packages/world/src/interactions/places';
import type { InteractionPlaces, InteractionView } from '../ports';
import { clearShot, createShotEase, seatShot, type FramedCamera, type PlaceShot } from './framing';

/**
 * The places an accepted interaction opens (spec 37 R9/R10). Each opener runs only after the room said yes and
 * only while walk-camera has handed the controller its token; each returns its own close, or null to leave the
 * walking camera where it is. Nothing here asks the room for anything or decides a seat.
 */
export type PlaceOpener = (record: InteractionRecord, closed: () => void) => InteractionView | null;

/** What every place view eases: the kingdom's one scene camera, its current collision and the motion preference. */
export interface PlaceStage {
  readonly camera: FramedCamera;
  readonly world: () => CollisionWorld | null;
  readonly reducedMotion: () => boolean;
  /** Your own body's feet as walking left them, so a framing can keep the body off its line. */
  readonly feet?: () => Vec3 | null;
}

export function framed(stage: PlaceStage, shot: PlaceShot | null) {
  const clear = shot && clearShot(stage.world(), shot);
  return clear ? createShotEase(stage.camera, clear, { reducedMotion: stage.reducedMotion() }) : null;
}

/**
 * A campfire log: the seated framing from the seat's own authored rest and facing, unless the campfire's scene
 * suggests its own shot for this seat (`suggest`, the clearing's seated suggestion once installed). A framing the
 * collision would cut keeps the walking camera rather than looking through a wall.
 */
export function createSeatPlace(stage: PlaceStage, suggest?: (record: InteractionRecord) => PlaceShot | null): PlaceOpener {
  return record => {
    const ease = framed(stage, suggest?.(record) ?? seatShot(record, stage.camera.aspect));
    return ease ? { frame: now => { ease.frame(now); }, close() {} } : null;
  };
}

/**
 * The tavern table's own view (spec 22's table presentation), opened for the admitted chair. Only an accepted
 * `tavern` reaches here, so a pending or declined admission never opens a table. `closed` is the table's Leave.
 */
export interface TableViewPort {
  open(seat: { readonly table: string; readonly seat: string; readonly record: InteractionRecord }, closed: () => void): { close(): void } | null;
}

/** A tavern chair: the table's own view over the seated framing. Without a table view, you simply sit at it. */
export function createTablePlace(stage: PlaceStage, table?: TableViewPort): PlaceOpener {
  const seat = createSeatPlace(stage);
  return (record, closed) => {
    const chair = tavernSeatOf(record.target.id);
    const view = chair && table ? table.open({ ...chair, record }, closed) : null;
    const seated = seat(record, closed);
    if (!view && !seated) return null;
    return { frame: now => { seated?.frame?.(now); }, close() { view?.close(); seated?.close(); } };
  };
}

/**
 * Spec 31's interior presentation of one installed home: it blends that home's painted interior treatment in around
 * its actual furnished shell for exactly as long as the room says you are inside, and takes it away on `close`. It
 * never moves the body, never holds the camera (you walk to the real exit), and never adds a light of its own beyond
 * the home's PeopleLight. The revision is the installed one the door was derived from.
 */
export interface HomeInteriorPort {
  enter(home: { readonly plotId: string; readonly revision: string | null }): { close(): void } | null;
}

/**
 * `InteractionPlaces` from the installed places. A family whose producer is not installed has no opener and keeps
 * the walking camera (the room has already said whether that action was possible at all). Without an interior
 * presentation, the home is the shell the street already draws: nothing pretends to be a painted room.
 */
export function composeInteractionPlaces(openers: { readonly bench?: PlaceOpener; readonly campfire?: PlaceOpener; readonly tavern?: PlaceOpener; readonly forge?: PlaceOpener; readonly home?: HomeInteriorPort }): InteractionPlaces {
  return {
    open({ action, record }, closed) {
      const opener = action === 'sit' ? record.target.kind === 'bench-seat' ? openers.bench : openers.campfire : action === 'tavern' ? openers.tavern : action === 'forge' ? openers.forge : undefined;
      return opener ? opener(record, closed) : null;
    },
    home: ({ plotId, door }) => openers.home?.enter({ plotId, revision: door?.revision ?? null }) ?? null,
  };
}
