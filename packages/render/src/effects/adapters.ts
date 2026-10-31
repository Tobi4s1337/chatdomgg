import type { ForgePhase, ForgeRitualFrame, KingdomPresenceFrame, Vec3 } from '@chatdom/shared';
import type { EffectSource, FlightCue, FlightSample, SparkBurst } from './types';

// Adapters from the kingdom's existing real state to effect inputs. Each is a pure translation: it reads what the
// caller already has (placed homes and fires, the public presence frame, the Forge ritual frame and the piece's
// actual animated position) and never infers occupancy, invents a path or starts an event.

/** A placed home with its authored chimney mouths in world metres (the kingdom's `HomeLifeSite` fits as is). */
export interface ChimneyHome { readonly slot: number; readonly mouths: readonly Vec3[] }

/** How long a home has had someone in before its hearth breathes: the fire is lit after they come in. */
export const HEARTH_SETTLE_MS = 700;

/**
 * Chimney smoke from presence: a home's real chimney mouths smoke while its window slot is present in the public
 * presence frame and has been for `settleMs`. A stale or missing frame claims nobody, so no chimney smokes.
 * Source ids are `home:<slot>:chimney:<i>`; they name the chimney, never the person.
 */
export function presenceChimneySmoke(homes: readonly ChimneyHome[], frame: KingdomPresenceFrame | null | undefined, atMs: number,
  settleMs = HEARTH_SETTLE_MS): EffectSource[] {
  if (!frame || frame.connection === 'stale' || !Number.isFinite(atMs)) return [];
  const since = new Map<number, number>();
  for (const window of frame.windows) if (window.present) since.set(window.slot, window.since);
  const out: EffectSource[] = [];
  for (const home of homes) {
    const at = since.get(home.slot);
    if (at === undefined || atMs - at < settleMs) continue;
    home.mouths.forEach((mouth, i) => out.push({ id: `home:${home.slot}:chimney:${i}`, position: mouth }));
  }
  return out;
}

/**
 * Embers from installed fires (gate braziers, the forge hearth): each source sits `lift` metres above its flame
 * anchor, where embers leave the flames. Ids are `<prefix>:<i>` in the caller's stable placement order.
 */
export function fireEmbers(fires: readonly { readonly position: Vec3 }[], prefix: string, lift = .22): EffectSource[] {
  return fires.map((fire, i) => ({ id: `${prefix}:${i}`, position: [fire.position[0], fire.position[1] + lift, fire.position[2]] as Vec3 }));
}

/** The ritual's phase spans in seconds, as `[phase, from, to]` (pass `FORGE_STAGE_TIMING` from `@chatdom/forge`). */
export type ForgeTiming = readonly (readonly [ForgePhase, number, number])[];

function span(timing: ForgeTiming, phase: ForgePhase): number {
  const row = timing.find(entry => entry[0] === phase);
  return row ? Math.max(0, row[2] - row[1]) : 0;
}

/** The effect-clock time the supplied phase began, or null for an untrustworthy frame. */
function phaseStart(frame: ForgeRitualFrame, time: number, timing: ForgeTiming): number | null {
  if (!Number.isFinite(time) || !Number.isFinite(frame.phaseProgress) || typeof frame.ritualId !== 'string' || !frame.ritualId) return null;
  return time - Math.min(1, Math.max(0, frame.phaseProgress)) * span(timing, frame.phase);
}

/**
 * The Forge's two real impacts as spark bursts: the hammer's strike on the anvil (seen from the strike phase on,
 * so a seek into the cooling still finds its tail), and the piece's contact with its socket on landing. Each burst
 * is named by the ritual and the impact, so it plays once per ritual.
 * `contact` is the share of the flight phase at which the piece meets its socket (the presentation's CONTACT).
 */
export function forgeSparks(frame: ForgeRitualFrame | null | undefined, places: { anvil: Vec3; landing?: Vec3 | null }, time: number,
  timing: ForgeTiming, contact = 1): SparkBurst[] {
  if (!frame) return [];
  const start = phaseStart(frame, time, timing);
  if (start === null) return [];
  const out: SparkBurst[] = [];
  const id = frame.ritualId;
  if (frame.phase === 'strike') out.push({ id: `forge:anvil`, position: places.anvil, burstId: `forge:${id}:strike`, startedAt: start });
  if (frame.phase === 'cool') out.push({ id: `forge:anvil`, position: places.anvil, burstId: `forge:${id}:strike`, startedAt: start - span(timing, 'strike') });
  if (places.landing) {
    const flight = span(timing, 'flight');
    const landed = frame.phase === 'flight' && frame.phaseProgress >= contact ? start + contact * flight
      : frame.phase === 'landed' ? start - (1 - contact) * flight : null;
    if (landed !== null) out.push({ id: `forge:landing`, position: places.landing, burstId: `forge:${id}:landing`, startedAt: landed });
  }
  return out;
}

/**
 * The flight cue from the ritual frame and the piece's actual animated world position this frame. Active through
 * the flight phase; through `landed` the cue stays, inactive, so the trail already laid fades where it is. The
 * trail is only the `history` the caller recorded (see `createFlightRecorder`); without it only the piece glints.
 */
export function forgeFlightCue(frame: ForgeRitualFrame | null | undefined, piece: Vec3 | null | undefined, time: number,
  timing: ForgeTiming, history?: readonly FlightSample[]): FlightCue | null {
  if (!frame || !piece || (frame.phase !== 'flight' && frame.phase !== 'landed')) return null;
  const start = phaseStart(frame, time, timing);
  if (start === null) return null;
  const startedAt = frame.phase === 'flight' ? start : start - span(timing, 'flight');
  return { id: `forge:${frame.ritualId}:flight`, position: piece, startedAt, active: frame.phase === 'flight', ...(history ? { history } : {}) };
}

/**
 * A bounded record of where a flying piece has actually been, stamped with the effect clock. Recording a new cue id
 * starts a fresh path; recording at or before the last stamp (a seek back) drops the samples after it, so the
 * history never holds a future the clock has not reached.
 */
export function createFlightRecorder(capacity = 96) {
  const limit = Math.max(2, Math.floor(capacity));
  let cue = '';
  const samples: FlightSample[] = [];
  return {
    record(id: string, time: number, position: Vec3): void {
      if (!Number.isFinite(time) || !position.every(Number.isFinite)) return;
      if (id !== cue) { cue = id; samples.length = 0; }
      while (samples.length && samples[samples.length - 1]!.time >= time) samples.pop();
      samples.push({ time, position: [position[0], position[1], position[2]] });
      if (samples.length > limit) samples.splice(0, samples.length - limit);
    },
    /** The recorded samples, oldest first. The array is reused; read it during the frame it was asked for. */
    history(): readonly FlightSample[] { return samples; },
    clear(): void { cue = ''; samples.length = 0; },
  };
}
