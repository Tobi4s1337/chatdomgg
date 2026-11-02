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
  /** Leave the destination room and free everything. Play awaits it before joining the source again. */
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
  /** Stand up (freeing any seat), stop walking and leave the source room. */
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

export function createPortalTransfer(options: PortalTransferOptions): PortalTransfer {
  const timers = options.timers ?? { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const readyMs = options.readyMs ?? PORTAL_READY_MS;
  const destinations = new Map<string, PortalDestination>();
  const listeners = new Set<(phase: PortalPhase) => void>();
  let phase: PortalPhase = 'idle', disposed = false;
  let bound: PortalSource | null = null;
  // The journey in progress: the source it left, the door, the destination's surface and its visit's generation.
  let journey: { source: PortalSource; portal: PortalDescriptor; surface: PortalSurface | null; visit: number; curtain: PortalCurtain } | null = null;
  let generation = 0;
  const set = (next: PortalPhase) => { if (phase === next) return; phase = next; for (const listener of [...listeners]) listener(next); };
  const cue = (name: PortalCue) => { try { options.cue?.(name); } catch { /* a silent door never stops a walk */ } };

  const destinationFor = (portal: PortalDescriptor) => destinations.get(portal.destinationRoom);

  async function disposeSurface(surface: PortalSurface | null) {
    if (!surface) return;
    try { await surface.dispose(); } catch (error) { console.error('The room behind the door did not close cleanly', error); }
  }

  /** Back to the source door. Keeps trying only when asked: a stranded curtain waits for the person's retry. */
  async function home(note: string | undefined): Promise<PortalOutcome> {
    const current = journey!;
    const { source, portal, curtain } = current;
    try {
      await source.rejoin({ portal: portal.id, anchor: portal.returnAnchor });
    } catch (error) {
      if (disposed || journey !== current) return 'back-outside';
      console.error('The way back through the door is not open', error);
      set('stranded');
      return new Promise<PortalOutcome>(resolve => {
        curtain.stranded(() => {
          if (disposed || journey !== current || phase !== 'stranded') return;
          set('returning');
          void home(note).then(resolve);
        });
      });
    }
    if (disposed || journey !== current) return 'back-outside';
    journey = null;
    set('idle');
    cue('latch');
    await curtain.open(note);
    curtain.dispose();
    return 'back-outside';
  }

  /** Out of the destination (walked out, failed, timed out or lost) and back through the source door. */
  async function out(note: string | undefined): Promise<PortalOutcome> {
    const current = journey;
    if (!current || disposed) return 'unavailable';
    generation++;   // the visit that was is now stale
    const surface = current.surface;
    current.surface = null;
    set('returning');
    cue('door');
    await Promise.all([current.curtain.close({ label: LABEL_OUT, title: current.source.title }), disposeSurface(surface)]);
    cue('threshold');
    return home(note);
  }

  async function enter(portal: PortalDescriptor): Promise<PortalOutcome> {
    if (disposed) return 'unavailable';
    if (phase !== 'idle') return 'busy';
    const problem = checkPortal(portal);
    if (problem) { console.error(problem); return 'unavailable'; }
    const source = bound, destination = destinationFor(portal);
    if (!source || !destination || !sameKingdom(source.kingdomId, portal.kingdomId)) return 'unavailable';
    const curtain = options.curtain();
    const current = { source, portal, surface: null as PortalSurface | null, visit: ++generation, curtain };
    journey = current;
    set('leaving');
    cue('door');
    try {
      await Promise.all([curtain.close({ label: LABEL_IN, title: portal.title ?? destination.title }), source.leave()]);
    } catch (error) {
      // The source room could not be left cleanly: stay (or be put back) outside rather than be in two rooms.
      console.error('The kingdom room could not be left for the door', error);
      if (disposed || journey !== current) return 'back-outside';
      set('returning');
      return home(NOTE_REFUSED);
    }
    if (disposed || journey !== current) return 'unavailable';
    cue('threshold');
    set('joining');
    const visitId = current.visit;
    const live = () => !disposed && journey === current && current.visit === visitId && generation === visitId;
    const visit: PortalVisit = {
      portal, entry: source.entry, endpoint: source.endpoint, self: source.self,
      get active() { return live() && (phase === 'joining' || phase === 'inside'); },
      leave() { if (live() && phase === 'inside') void out(undefined); },
      fail(reason: string) {
        if (!live() || (phase !== 'joining' && phase !== 'inside')) return;
        console.error(`The room behind the door ${portal.id} gave up: ${reason}`);
        if (phase === 'inside') void out(NOTE_LOST);
        else rejectReady?.(new Error(reason));
      },
    };
    let rejectReady: ((error: Error) => void) | undefined;
    try {
      const surface = destination.mount(curtain.stage, visit);
      current.surface = surface;
      await new Promise<void>((resolve, reject) => {
        rejectReady = reject;
        const timer = timers.set(() => reject(new Error('The room behind the door did not answer in time.')), readyMs);
        surface.ready.then(() => { timers.clear(timer); resolve(); }, error => { timers.clear(timer); reject(error instanceof Error ? error : new Error(String(error))); });
      });
    } catch (error) {
      if (disposed || journey !== current) return 'back-outside';
      console.error(`The door ${portal.id} would not open`, error);
      generation++;
      const surface = current.surface;
      current.surface = null;
      set('returning');
      await disposeSurface(surface);
      return home(NOTE_REFUSED);
    }
    rejectReady = undefined;
    if (disposed || journey !== current) return 'unavailable';
    set('inside');
    cue('latch');
    await curtain.open();
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
      if (current) { void disposeSurface(current.surface); current.curtain.dispose(); }
      listeners.clear();
      bound = null;
    },
  };
}
