import type { CameraName } from '../kingdom/scene';
import type { StreamLayout, StreamMood, StreamSeam } from './params';
import type { PlaceShot } from '../interactions/places/framing';
import { snapshotDirectorCue, type DirectorCue, type DirectorCueSource } from './director-cues';
export type { DirectorCue, DirectorCueSource } from './director-cues';

/**
 * The stream's director: it only chooses among the renderer's supported cameras and
 * cuts when the world gives a shot its subject. Calm holds one shot; show and the seams
 * tour the night with a minimum hold, behind shutters (show) or a dip through dusk (calm).
 * Nothing here invents a moment: a close shot needs a real lit window or a real walker.
 */
export type Shot = CameraName;
export type Cut = 'shutter' | 'dip';
export type Curtain = 'open' | 'closing' | 'shut' | 'opening';

export interface Beat { shot: Shot; hold: number; climax?: boolean }
export interface Plan {
  beats: readonly Beat[];
  /** How one shot gives way to the next; null for a single held shot. */
  cut: Cut | null;
  /** The sky's own movement through the seam, in hours. */
  sky: { from: number; to: number; seconds: number } | null;
  /** Slow drift on a held picture: calm never cuts, so the frame breathes instead. */
  drift: boolean;
}

/** No shot is cut away from sooner than this, whatever the beat asks. */
export const MIN_HOLD = 8;
const TIMING: Record<Cut, { close: number; open: number; settle: number }> = {
  shutter: { close: 460, open: 720, settle: 320 },
  dip: { close: 1100, open: 1500, settle: 200 },
};
/** The name rises a moment after the window is seen and leaves before the cut. */
const CLIMAX: [number, number] = [1.6, 6.8];

export function planNight({ layout, mood, seam, camera, hour }: { layout: StreamLayout; mood: StreamMood; seam: StreamSeam | null; camera: Shot; hour: number }): Plan {
  const held = (shot: Shot): Plan => ({ beats: [{ shot, hold: Infinity }], cut: null, sky: null, drift: true });
  // Seams are full-screen scenes. The window and the strip carry no text but a name, so
  // they keep their own close framing whatever seam the stage is in.
  if (layout === 'window') return mood === 'show'
    ? { beats: [{ shot: 'window', hold: 20, climax: true }, { shot: 'citizen', hold: 14 }], cut: 'shutter', sky: null, drift: false }
    : held('window');
  if (layout === 'strip') return mood === 'show'
    ? { beats: [{ shot: 'window', hold: 24, climax: true }, { shot: 'citizen', hold: 16 }], cut: 'shutter', sky: null, drift: false }
    : held('window');
  const slow = mood === 'calm' ? 1.5 : 1, cut: Cut = mood === 'show' ? 'shutter' : 'dip';
  const tour = (beats: Beat[]): Beat[] => beats.map(beat => ({ ...beat, hold: beat.hold * slow }));
  // The opening is one continuous arrival: its scene follows the wave into the
  // lantern street. An independent tour would shut the town behind doors mid-wave
  // and replace that moving lens. Real arrivals likewise own their homecoming lens.
  if (seam === 'starting') return {
    ...held('hero'),
    // The opening is dusk already: the people, rather than a changing sun, light the town.
    sky: null, drift: mood === 'calm',
  };
  // A break tours the night so far: only what the world can show, the town and its lit windows.
  // On a grand land the tour also widens to the island and to the town against its water; a land without them skips both.
  if (seam === 'break') return { beats: tour([{ shot: 'island', hold: 14 }, { shot: 'hero', hold: 18 }, { shot: 'window', hold: 12, climax: true }, { shot: 'pier', hold: 12 }, { shot: 'citizen', hold: 12 }, { shot: 'vista', hold: 14 }]), cut, sky: null, drift: mood === 'calm' };
  // Ending settles on the night town. No Ballad or procession exists to be shown, so none is.
  if (seam === 'ending') return { ...held('hero'), sky: hour >= 12 && hour < 22 ? { from: hour, to: 22, seconds: 90 } : null };
  if (mood === 'calm') return held(camera);
  const show: Beat[] = [{ shot: 'hero', hold: 16 }, { shot: 'window', hold: 10, climax: true }, { shot: 'pier', hold: 12 }, { shot: 'citizen', hold: 12 }, { shot: 'vista', hold: 14 }, { shot: 'island', hold: 12 }];
  const first = Math.max(0, show.findIndex(beat => beat.shot === camera));
  return { beats: [...show.slice(first), ...show.slice(0, first)], cut: 'shutter', sky: null, drift: false };
}

export interface DirectorState {
  shot: Shot;
  beat: number;
  curtain: Curtain;
  cut: Cut | null;
  /** True while the beat's one public name may be shown. */
  climax: boolean;
  /** The game currently holding the camera; the base tour shot remains unchanged. */
  placeCue?: string;
}

export interface DirectorHost {
  /** Whether the world currently gives this shot a subject. */
  motive(shot: Shot): boolean;
  /** Point the live scene's supported camera at the shot. */
  apply(shot: Shot): void;
  /** Optional place layer. The scene still gives walking, raids and major moments priority. */
  applyPlace?(shot: PlaceShot | null): void;
  /** Whether the renderer has drawn the shot with its light settled. */
  drawn(shot: Shot): boolean;
  setHour(hour: number): void;
  reducedMotion(): boolean;
  onChange(state: DirectorState): void;
}

export function createDirector(initial: Plan, host: DirectorHost, now: () => number = () => performance.now(), epoch: () => number = () => Date.now()) {
  let plan = initial, beat = 0, shot = plan.beats[0]!.shot, curtain: Curtain = 'open', climax = false;
  let since = now(), lastCut = -Infinity, running = false, tick = 0, step = 0, skyStart = now(), lastHour = NaN;
  let disposed = false, held = false, activeCue: DirectorCue | null = null;
  const sources = new Set<{ cue: DirectorCue | null; unsubscribe?: () => void }>();
  /** Every cut, for reviews: the shot and when it opened. Never shown on stream. */
  const cuts: { shot: Shot; at: number }[] = [];

  const state = (): DirectorState => ({ shot, beat, curtain, cut: plan.cut, climax, ...(activeCue ? { placeCue: activeCue.id } : {}) });
  const publish = () => host.onChange(state());
  const later = (ms: number, then: () => void) => { window.clearTimeout(step); step = window.setTimeout(then, ms); };

  function skyHour(): number | null {
    if (!plan.sky) return null;
    const { from, to, seconds } = plan.sky, t = Math.min(1, Math.max(0, (now() - skyStart) / 1000 / seconds));
    return from + (to - from) * t * t * (3 - 2 * t);
  }

  function transition(next: number): void {
    const target = plan.beats[next]!;
    beat = next;
    lastCut = now();
    climax = false;
    if (!plan.cut || host.reducedMotion()) {
      // Reduced motion keeps the meaning, a new shot, without the shutters' movement.
      shot = target.shot; host.apply(shot); since = now(); cuts.push({ shot, at: since }); publish();
      return;
    }
    const timing = TIMING[plan.cut];
    curtain = 'closing'; publish();
    later(timing.close, () => {
      curtain = 'shut'; shot = target.shot; host.apply(shot); publish();
      const shutAt = now();
      const wait = () => {
        // Open on the drawn shot, or after a bounded wait rather than holding the frame shut.
        if (now() - shutAt >= timing.settle && (host.drawn(shot) || now() - shutAt > 3500)) {
          curtain = 'opening'; publish();
          later(timing.open, () => { curtain = 'open'; since = now(); lastCut = since; cuts.push({ shot, at: since }); publish(); });
        } else later(60, wait);
      };
      wait();
    });
  }

  function update(): void {
    if (!running || held || disposed) return;
    const hour = skyHour();
    if (hour !== null && !(Math.abs(hour - lastHour) < .004)) { lastHour = hour; host.setHour(hour); }
    let cue: DirectorCue | null = null;
    for (const source of sources) {
      if (source.cue?.until !== null && source.cue && source.cue.until <= epoch()) source.cue = null;
      // Stable subscription order prevents equal-priority game sources from alternating each frame.
      if (!cue && source.cue) cue = source.cue;
    }
    if (host.applyPlace && cue !== activeCue) {
      window.clearTimeout(step);
      if (curtain !== 'open') beat = Math.max(0, plan.beats.findIndex(candidate => candidate.shot === shot));
      curtain = 'open'; climax = false; since = now();
      activeCue = cue; host.applyPlace(cue?.shot ?? null); publish();
    }
    if (activeCue) return;
    if (curtain !== 'open') return;
    const elapsed = (now() - since) / 1000, current = plan.beats[beat]!;
    const nextClimax = !!current.climax && current.shot === shot && elapsed >= CLIMAX[0] && elapsed < CLIMAX[1] && host.motive(shot);
    if (nextClimax !== climax) { climax = nextClimax; publish(); }
    // A held shot is the calm shot itself; only a tour needs its subject to stay.
    const lost = plan.beats.length > 1 && !host.motive(shot);
    if ((elapsed < current.hold && !lost) || (now() - lastCut) / 1000 < MIN_HOLD) return;
    // The next beat the world can give a subject; an unavailable beat falls back to the town.
    for (let offset = 1; offset <= plan.beats.length; offset++) {
      const index = (beat + offset) % plan.beats.length, candidate = plan.beats[index]!;
      if (!host.motive(candidate.shot)) continue;
      if (candidate.shot === shot) { beat = index; since = now(); publish(); return; }
      transition(index);
      return;
    }
    // Nothing to tour: rest on the plan's calm shot, the town on the stage, the window in the small shapes.
    const home = Math.max(0, plan.beats.findIndex(candidate => candidate.shot === 'hero'));
    if (lost && plan.beats[home]!.shot !== shot) transition(home);
    else since = now();
  }

  /** Close any transition at once: hidden sources and new plans never wait on shutters. */
  function settle(): void {
    window.clearTimeout(step);
    if (curtain !== 'open') {
      beat = Math.max(0, plan.beats.findIndex(candidate => candidate.shot === shot));
      curtain = 'open'; since = now(); publish();
    }
  }

  return {
    get state(): DirectorState { return state(); },
    get shot() { return shot; },
    get plan() { return plan; },
    cuts,
    /** The hour the sky should hold now, for a scene being built. */
    hour: (fallback: number) => skyHour() ?? fallback,
    start(): void {
      if (running || disposed) return;
      running = true;
      since = now();
      tick = window.setInterval(update, 250);
      update();
    },
    stop(): void {
      running = false;
      window.clearInterval(tick);
      settle();
      if (activeCue) { activeCue = null; host.applyPlace?.(null); }
      climax = false;
      publish();
    },
    /** A streamer's choice is not a director's cut: it applies at once, without the hold. */
    replan(next: Plan): void {
      const sameSky = JSON.stringify(next.sky) === JSON.stringify(plan.sky);
      settle();
      plan = next;
      if (!sameSky) { skyStart = now(); lastHour = NaN; }
      const keep = plan.beats.findIndex(candidate => candidate.shot === shot);
      if (keep >= 0) { beat = keep; since = now(); climax = false; publish(); }
      else { lastCut = -Infinity; if (running && !activeCue) transition(0); else { beat = 0; shot = plan.beats[0]!.shot; if (activeCue) host.apply(shot); publish(); } }
    },
    /** Reviews only: pause the director's clock (never the scene) while a slow capture is taken. */
    hold(on: boolean): void {
      held = on;
      window.clearInterval(tick);
      if (!on && running) tick = window.setInterval(update, 250);
    },
    /** Attach a verified kingdom's producer. Unsubscribe on scene/kingdom replacement. */
    connect(source: DirectorCueSource): () => void {
      if (disposed) throw new Error('The stream director has closed');
      const entry: { cue: DirectorCue | null; unsubscribe?: () => void } = { cue: null };
      sources.add(entry);
      try {
        entry.unsubscribe = source.subscribe(value => {
          if (!sources.has(entry) || disposed) return;
          entry.cue = snapshotDirectorCue(value, epoch()); update();
        });
      } catch (error) { sources.delete(entry); update(); throw error; }
      return () => { if (!sources.delete(entry)) return; entry.unsubscribe?.(); update(); };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; running = false; window.clearInterval(tick); window.clearTimeout(step);
      if (activeCue) { activeCue = null; host.applyPlace?.(null); }
      const previous = [...sources]; sources.clear();
      for (const source of previous) source.unsubscribe?.();
    },
  };
}

export type Director = ReturnType<typeof createDirector>;
