import type { KingdomId, Vec3 } from '@chatdom/shared';
import type { RealmEntry } from '../realm/client';
import type { PlayContext } from './slots';

/**
 * Doors into rooms of their own (work/lanes/play/SEAMS.md, B1b). The tavern is the first: you go through its door,
 * leave the kingdom room, join the kingdom's tavern room, and walking out brings you back outside the same door.
 *
 * Play owns the transfer and its recovery; a destination lane (gather for the tavern) owns the room and its scene.
 * - One walker in exactly one room: the source room is left before the destination is joined, and the destination
 *   is disposed before the source is joined again.
 * - Leaving a room is awaited to the end, the kingdom and the destination alike. A leave that fails or stays silent
 *   strands the curtain with a retry; it never lets the next room join early, and a room that refused to let you go
 *   is never joined again on top of itself: it is left first.
 * - Entry is never reported before the destination says it is ready. A destination that fails, times out or is
 *   lost puts you back outside the door; while that way back is not open, the curtain says so and offers a retry.
 * - The session travels, the ticket never does: the destination asks `visit.entry.ticket()` for a fresh one.
 * - A visit that has ended can no longer steer the transfer (its leave and fail calls are ignored).
 */

/** Where a walker stands after a door: feet in world metres, yaw in radians (the room's own convention). */
export interface PortalAnchor { readonly feet: Vec3; readonly yaw: number }

/** A door into a room of its own. The destination lane supplies it; play reads it. */
export interface PortalDescriptor {
  readonly id: string;
  readonly kingdomId: KingdomId;
  readonly sourceRoom: 'kingdom';
  /** The destination room type, e.g. 'tavern'. A destination must be registered for it. */
  readonly destinationRoom: string;
  /** Just inside the destination's door, facing the room. */
  readonly entryAnchor: PortalAnchor;
  /** Just outside the source door, facing out. Exterior orientation comes from the placement, never the interior. */
  readonly returnAnchor: PortalAnchor;
  /** The words on the curtain going in; defaults to the destination's title. Sentence case, 2 to 40 characters. */
  readonly title?: string;
}

/** What play lends a destination while you are inside it. */
export interface PortalVisit {
  readonly portal: PortalDescriptor;
  /** The same signed-in session the source used. Ask it for a fresh ticket; never reuse the source's. */
  readonly entry: RealmEntry;
  /** The realm transport endpoint the source joined through. */
  readonly endpoint: string;
  readonly self: PlayContext['self'];
  /** False once this visit has ended (you walked out, it failed, or the page left). */
  readonly active: boolean;
  /** Walk back out through the door. Ignored once the visit has ended. */
  leave(): void;
  /** The destination cannot go on (refused, revoked, gone for good): play takes you back outside. */
  fail(reason: string): void;
}

/** A room's scene and connection, mounted into a full-window layer under the curtain. */
export interface PortalSurface {
  /** Resolves once you stand in the destination room, authoritative state and scene both in; rejects if never. */
  readonly ready: Promise<void>;
  /**
   * Leave the destination room and free everything. Play awaits it before joining the source again, so resolve once
   * the room has really let you go (a connection that is already gone counts) and reject only while you may still be
   * in it: play then says so on the curtain and calls dispose again on the person's retry.
   */
  dispose(): void | Promise<void>;
}

export interface PortalDestination {
  /** The room type it draws, e.g. 'tavern'. One destination per room type. */
  readonly room: string;
  /** The curtain's words going in, e.g. 'The tavern'. */
  readonly title: string;
  mount(host: HTMLElement, visit: PortalVisit): PortalSurface;
}

/** What the source (the kingdom walk and its entry) does for a door. */
export interface PortalSource {
  readonly kingdomId: KingdomId;
  readonly entry: RealmEntry;
  readonly endpoint: string;
  readonly self: PlayContext['self'];
  /** The curtain's words coming back, e.g. the kingdom's name. */
  readonly title: string;
  /**
   * Stand up (freeing any seat), stop walking and leave the source room. Like a destination's dispose: resolve once the
   * room has really let you go (a connection already gone counts) and reject only while you may still be in it. Play
   * then calls leave again (once at once, then on the person's retry) and joins the room again only after it resolves.
   */
  leave(): Promise<void>;
  /** Join the source room with a fresh ticket, arriving at the anchor; resolves once you are walking there. */
  rejoin(arrival: { readonly portal: string; readonly anchor: PortalAnchor }): Promise<void>;
}

export type PortalPhase =
  | 'idle'        // walking in the source room
  | 'leaving'     // the curtain closes while the source room is left
  | 'joining'     // the destination is mounted and has not said it is ready
  | 'inside'      // walking in the destination room
  | 'returning'   // the curtain closes, the destination is left and the source joined again
  | 'stranded';   // neither room holds you: the curtain stays, says so, and offers to try the door again

export type PortalOutcome = 'arrived' | 'back-outside' | 'unavailable' | 'busy';

/** The curtain the transfer draws over both scenes. `hud/portal-curtain.ts` is the real one. */
export interface PortalCurtain {
  /** Close over the current scene; resolves once fully closed. */
  close(words: { readonly label: string; readonly title: string }): Promise<void>;
  /** Open onto the scene beneath; resolves once fully open. A note stays a moment on the opened scene. */
  open(note?: string): Promise<void>;
  /** Stay closed and say the way back is not open, with one button that calls retry. */
  stranded(retry: () => void): void;
  /** The layer destinations mount into, under the curtain. */
  readonly stage: HTMLElement;
  dispose(): void;
}

export type PortalCue = 'door' | 'threshold' | 'latch';

export interface PortalTransferOptions {
  readonly curtain: () => PortalCurtain;
  readonly cue?: (cue: PortalCue) => void;
  /** How long a destination may take to say it is ready. */
  readonly readyMs?: number;
  /** How long leaving a room or opening the way back may stay silent before the curtain says so. */
  readonly stepMs?: number;
  /** For tests; defaults to the page's timers. */
  readonly timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export interface PortalTransfer {
  readonly phase: PortalPhase;
  /** The door you are inside, or null. */
  readonly inside: PortalDescriptor | null;
  onPhase(listener: (phase: PortalPhase) => void): () => void;
  /** True when this door can really be used now: a source is bound for its kingdom and its room has a destination. */
  available(portal: PortalDescriptor): boolean;
  /** The words for this door: its own title, else its destination's; null without a destination. */
  title(portal: PortalDescriptor): string | null;
  /** Go through the door. Resolves when you stand in the destination, or back outside if it would not open. */
  enter(portal: PortalDescriptor): Promise<PortalOutcome>;
  /** Walk back out of the room you are in. */
  leave(): Promise<PortalOutcome>;
  /** The walk binds its source while it lives; the transfer keeps the one a journey started from. */
  bindSource(source: PortalSource): () => void;
  registerDestination(destination: PortalDestination): () => void;
  dispose(): void;
}

export const PORTAL_READY_MS = 20_000;
/** How long leaving a room or opening the way back may stay silent before the curtain says so. */
export const PORTAL_STEP_MS = 12_000;
const LABEL_IN = 'Through the door', LABEL_OUT = 'Back out the door';
const NOTE_REFUSED = 'The door would not open just now. You are back outside.';
const NOTE_LOST = 'The room let you go. You are back outside.';

const sameKingdom = (a: KingdomId, b: KingdomId) => a === b;
function checkAnchor(anchor: PortalAnchor | undefined): anchor is PortalAnchor {
  return !!anchor && Array.isArray(anchor.feet) && anchor.feet.length === 3 && anchor.feet.every(Number.isFinite) && Number.isFinite(anchor.yaw);
}
export function checkPortal(portal: PortalDescriptor): string | null {
  if (!portal || typeof portal.id !== 'string' || !portal.id) return 'A door needs an id.';
  if (portal.sourceRoom !== 'kingdom') return `The door ${portal.id} must open from the kingdom.`;
  if (typeof portal.destinationRoom !== 'string' || !portal.destinationRoom || portal.destinationRoom === 'kingdom') return `The door ${portal.id} needs a room of its own.`;
  if (!checkAnchor(portal.entryAnchor) || !checkAnchor(portal.returnAnchor)) return `The door ${portal.id} needs finite entry and return anchors.`;
  if (portal.title !== undefined && (typeof portal.title !== 'string' || portal.title.trim().length < 2 || portal.title.length > 40)) return `The door ${portal.id} has an unreadable title.`;
  return null;
}

/** One run at a time: a call while one is in flight joins it, a failed run may run again, a finished one stays done. */
function once(run: () => void | Promise<void>): () => Promise<void> {
  let flight: Promise<void> | null = null;
  return () => flight ??= (async () => { await run(); })().catch((error: unknown) => { flight = null; throw error; });
}
const noop = () => {};

type Settled = { readonly kind: 'ok' } | { readonly kind: 'failed'; readonly error: unknown } | { readonly kind: 'silent' } | { readonly kind: 'ended' };

interface Journey {
  readonly source: PortalSource;
  readonly portal: PortalDescriptor;
  readonly curtain: PortalCurtain;
  /** The visit generation this journey lent out; a newer generation makes the visit stale. */
  readonly visit: number;
  /** Leaves the source room; one run at a time, a refused run may run again. Nothing joins it again before it resolves. */
  readonly leaveSource: () => Promise<void>;
  /** The destination's surface until it has really been left. */
  surface: PortalSurface | null;
  leaveRoom: (() => Promise<void>) | null;
  /** A `visit.fail` that came before the ready race began (for example from inside `mount`). */
  failure: Error | null;
  failReady: ((error: Error) => void) | null;
  /** Resolves when the journey is over (home again or the page gone), so no wait outlives it. */
  readonly ended: Promise<void>;
  end(): void;
}

export function createPortalTransfer(options: PortalTransferOptions): PortalTransfer {
  const timers = options.timers ?? { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const readyMs = options.readyMs ?? PORTAL_READY_MS;
  const stepMs = options.stepMs ?? PORTAL_STEP_MS;
  const destinations = new Map<string, PortalDestination>();
  const listeners = new Set<(phase: PortalPhase) => void>();
  let phase: PortalPhase = 'idle', disposed = false;
  let bound: PortalSource | null = null;
  let journey: Journey | null = null;
  let generation = 0;
  const set = (next: PortalPhase) => { if (phase === next) return; phase = next; for (const listener of [...listeners]) listener(next); };
  const cue = (name: PortalCue) => { try { options.cue?.(name); } catch { /* a silent door never stops a walk */ } };
  /** The curtain is drawn for the person; a curtain that stumbles never stops the journey under it. */
  const draw = async (run: () => Promise<void> | void) => { try { await run(); } catch (error) { console.error('The door curtain stumbled', error); } };
  const over = (current: Journey) => disposed || journey !== current;

  const destinationFor = (portal: PortalDescriptor) => destinations.get(portal.destinationRoom);

  function newJourney(source: PortalSource, portal: PortalDescriptor, curtain: PortalCurtain): Journey {
    let end = noop;
    const ended = new Promise<void>(resolve => { end = resolve; });
    return { source, portal, curtain, visit: ++generation, leaveSource: once(() => source.leave()), surface: null, leaveRoom: null, failure: null, failReady: null, ended, end };
  }

  /** How a step went within `ms`: done, failed, still silent, or the journey ended under it. */
  function settle(current: Journey, flight: Promise<void>, ms: number): Promise<Settled> {
    return new Promise<Settled>(resolve => {
      const timer = timers.set(() => resolve({ kind: 'silent' }), ms);
      const done = (result: Settled) => { timers.clear(timer); resolve(result); };
      flight.then(() => done({ kind: 'ok' }), (error: unknown) => done({ kind: 'failed', error }));
      void current.ended.then(() => done({ kind: 'ended' }));
    });
  }

  /**
   * A step the journey never goes past until it is really done: the room behind you left, the way back open. A step
   * that fails or stays silent strands the curtain; the person's retry runs it again (or joins the one still going),
   * and a late success goes on by itself. False when the journey ended meanwhile.
   */
  async function must(current: Journey, step: () => Promise<void>, what: string): Promise<boolean> {
    for (;;) {
      const flight = step();
      const result = await settle(current, flight, stepMs);
      if (over(current) || result.kind === 'ended') return false;
      if (result.kind === 'ok') return true;
      console.error(what, result.kind === 'failed' ? result.error : `still not done after ${stepMs} ms`);
      set('stranded');
      await new Promise<void>(resolve => {
        current.curtain.stranded(resolve);
        if (result.kind === 'silent') flight.then(resolve, noop);
        void current.ended.then(resolve);
      });
      if (over(current)) return false;
      set('returning');
    }
  }

  /**
   * Back to the source door, once the source room has really been let go. A leave that was refused may still hold you
   * in that room, so it is run again (and, failing that, on the person's retry) before the room is joined: never a
   * second connection on top of the first. A leave that already went through is not repeated.
   */
  async function home(current: Journey, note: string | undefined): Promise<PortalOutcome> {
    const { source, portal, curtain } = current;
    if (!(await must(current, current.leaveSource, 'The kingdom room did not let you go'))) return 'back-outside';
    const rejoin = once(() => source.rejoin({ portal: portal.id, anchor: portal.returnAnchor }));
    if (!(await must(current, rejoin, 'The way back through the door is not open'))) return 'back-outside';
    journey = null;
    current.end();
    set('idle');
    cue('latch');
    await draw(() => curtain.open(note));
    curtain.dispose();
    return 'back-outside';
  }

  /** Out of the destination room, waiting until it has really let you go, then home. */
  async function back(current: Journey, note: string | undefined, closing: Promise<void>): Promise<PortalOutcome> {
    if (current.surface) {
      const surface = current.surface;
      current.leaveRoom ??= once(() => surface.dispose());
      const left = await Promise.all([must(current, current.leaveRoom, 'The room behind the door did not let you go'), closing]).then(([ok]) => ok);
      if (!left) return 'back-outside';
      current.surface = null;
      current.leaveRoom = null;
    } else await closing;
    if (over(current)) return 'back-outside';
    cue('threshold');
    return home(current, note);
  }

  /** Walked out, failed or lost while inside: the curtain closes as the destination is left. */
  function out(note: string | undefined): Promise<PortalOutcome> {
    const current = journey;
    if (!current || disposed) return Promise.resolve('unavailable');
    generation++;   // the visit that was is now stale
    set('returning');
    cue('door');
    return back(current, note, draw(() => current.curtain.close({ label: LABEL_OUT, title: current.source.title })));
  }

  async function enter(portal: PortalDescriptor): Promise<PortalOutcome> {
    if (disposed) return 'unavailable';
    if (phase !== 'idle') return 'busy';
    const problem = checkPortal(portal);
    if (problem) { console.error(problem); return 'unavailable'; }
    const source = bound, destination = destinationFor(portal);
    if (!source || !destination || !sameKingdom(source.kingdomId, portal.kingdomId)) return 'unavailable';
    const curtain = options.curtain();
    const current = newJourney(source, portal, curtain);
    journey = current;
    set('leaving');
    cue('door');
    // The source room must really be let go before another room is joined; the curtain closing never decides that.
    const closing = draw(() => curtain.close({ label: LABEL_IN, title: portal.title ?? destination.title }));
    const [, left] = await Promise.all([closing, settle(current, current.leaveSource(), stepMs)]);
    if (over(current) || left.kind === 'ended') return 'unavailable';
    if (left.kind !== 'ok') {
      // Refused or silent: never the tavern, and never the kingdom joined on top of a room that may still hold you. The
      // way back first sees the leave through (joining one still going, running a refused one again), then joins.
      console.error('The kingdom room could not be left for the door', left.kind === 'failed' ? left.error : `still not left after ${stepMs} ms`);
      set('returning');
      return home(current, NOTE_REFUSED);
    }
    cue('threshold');
    set('joining');
    const visitId = current.visit;
    const live = () => !over(current) && generation === visitId;
    const visit: PortalVisit = {
      portal, entry: source.entry, endpoint: source.endpoint, self: source.self,
      get active() { return live() && (phase === 'joining' || phase === 'inside'); },
      leave() { if (live() && phase === 'inside') void out(undefined); },
      fail(reason: string) {
        if (!live() || (phase !== 'joining' && phase !== 'inside')) return;
        console.error(`The room behind the door ${portal.id} gave up: ${reason}`);
        if (phase === 'inside') { void out(NOTE_LOST); return; }
        // Joining: this may come from inside mount, before the ready race exists. Keep it so the race starts lost.
        const error = new Error(reason);
        current.failure ??= error;
        current.failReady?.(error);
      },
    };
    let ready: Settled;
    try {
      const surface = destination.mount(curtain.stage, visit);
      if (!surface || typeof surface.dispose !== 'function' || typeof surface.ready?.then !== 'function') throw new Error(`The destination ${destination.room} returned no room surface.`);
      current.surface = surface;
      ready = await new Promise<Settled>(resolve => {
        if (current.failure) { resolve({ kind: 'failed', error: current.failure }); return; }
        const timer = timers.set(() => resolve({ kind: 'silent' }), readyMs);
        const done = (result: Settled) => { timers.clear(timer); current.failReady = null; resolve(result); };
        current.failReady = error => done({ kind: 'failed', error });
        surface.ready.then(() => done({ kind: 'ok' }), (error: unknown) => done({ kind: 'failed', error }));
        void current.ended.then(() => done({ kind: 'ended' }));
      });
    } catch (error) {
      ready = { kind: 'failed', error };
    }
    if (over(current) || ready.kind === 'ended') return 'unavailable';
    if (ready.kind !== 'ok') {
      console.error(`The door ${portal.id} would not open`, ready.kind === 'failed' ? ready.error : `no answer after ${readyMs} ms`);
      generation++;
      set('returning');
      return back(current, NOTE_REFUSED, Promise.resolve());
    }
    set('inside');
    cue('latch');
    await draw(() => curtain.open());
    return 'arrived';
  }

  return {
    get phase() { return phase; },
    get inside() { return phase === 'inside' ? journey?.portal ?? null : null; },
    onPhase(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    available(portal) {
      return !disposed && phase === 'idle' && checkPortal(portal) === null && !!bound && sameKingdom(bound.kingdomId, portal.kingdomId) && !!destinationFor(portal);
    },
    title(portal) { return portal.title ?? destinationFor(portal)?.title ?? null; },
    enter,
    leave() { return phase === 'inside' ? out(undefined) : Promise.resolve('unavailable'); },
    bindSource(source) {
      bound = source;
      return () => { if (bound === source) bound = null; };
    },
    registerDestination(destination) {
      if (!destination || typeof destination.room !== 'string' || !destination.room || destination.room === 'kingdom') throw new Error('A door destination needs a room type of its own.');
      if (typeof destination.title !== 'string' || destination.title.trim().length < 2) throw new Error(`The destination ${destination.room} needs a title.`);
      if (destinations.has(destination.room)) throw new Error(`The destination ${destination.room} is already registered.`);
      destinations.set(destination.room, destination);
      return () => { if (destinations.get(destination.room) === destination) destinations.delete(destination.room); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      const current = journey;
      journey = null;
      if (current) {
        current.end();
        const surface = current.surface;
        if (surface) (current.leaveRoom ?? once(() => surface.dispose()))().catch((error: unknown) => console.error('The room behind the door did not close cleanly', error));
        current.curtain.dispose();
      }
      listeners.clear();
      bound = null;
    },
  };
}
