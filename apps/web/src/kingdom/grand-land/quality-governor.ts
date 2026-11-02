import type { SceneQuality } from './scene-quality';

/**
 * The automatic quality governor (GW12, spec 56 "quality governor"). It watches what each frame costs and moves
 * the scene's automatic quality one step at a time between high, balanced and low. Those steps scale effects and
 * distant detail only (post resolution, ambient occlusion, bloom, the reflection, far land detail); the palette,
 * the light, the near voxel detail and the dusk windows never change (E10).
 *
 * Cost is measured, never guessed from the device name:
 * - GPU time per frame from timer queries where the browser offers them, plus the main thread's render time.
 *   This works at any display refresh, inside OBS (whose browser source sets its own frame rate) and behind a
 *   60 Hz vsync, where frame intervals alone cannot show headroom.
 * - Without timer queries, the frame interval against a 60 Hz frame: a step up is then a probe, and a probe that
 *   misses within a few seconds is undone and the next probe waits twice as long.
 *
 * A step down needs the 90th percentile over budget for two seconds; a step up needs it under half the budget
 * for ten. Steps are proposed, and the host applies them at a cut (or after a few seconds without one), so the
 * picture never changes mid-shot without need. A person's own choice switches the governor off.
 */
export interface GovernorBudget {
  /** Milliseconds of GPU time the frame may take (spec 56: 10 gaming, 12 laptop, 4 beside a game in OBS). */
  readonly gpuMs: number;
  /** Milliseconds of main-thread render work per frame. */
  readonly cpuMs: number;
  /** The frame interval to hold when only intervals are known. */
  readonly intervalMs: number;
}
export const GOVERNOR_BUDGETS = Object.freeze({
  desktop: Object.freeze({ gpuMs: 10, cpuMs: 10, intervalMs: 1000 / 60 }),
  // An OBS browser source draws at the frame rate set on the source, 30 by default.
  obs: Object.freeze({ gpuMs: 4, cpuMs: 8, intervalMs: 1000 / 30 }),
}) satisfies Record<string, GovernorBudget>;

export interface GovernorSample {
  readonly at: number;
  /** Interval since the previous drawn frame. */
  readonly intervalMs: number;
  /** Main-thread time spent rendering this frame. */
  readonly cpuMs: number;
  /** GPU time of this frame's passes, or null when no timer result exists for it. */
  readonly gpuMs: number | null;
}
export interface GovernorState {
  readonly quality: SceneQuality;
  /** A step waiting for the host to apply it at a cut. */
  readonly proposed: SceneQuality | null;
  readonly reason: string | null;
  readonly steps: number;
  readonly measuredBy: 'timer' | 'interval';
  readonly p90: { readonly gpuMs: number | null; readonly cpuMs: number; readonly intervalMs: number } | null;
}

const ORDER: readonly SceneQuality[] = ['low', 'balanced', 'high'];
const WINDOW_MS = 1000, JUDGE_MS = 100;
const DOWN_MS = 2000, UP_MS = 10_000, PROBE_MS = 4000, SETTLE_MS = 3000;
/** A frame interval over this share of the frame budget counts as a miss (vsync jitter stays under it). */
const MISS = 1.25;

function p90(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .9))]!;
}

export function createQualityGovernor(options: {
  readonly start: SceneQuality; readonly budget: GovernorBudget; readonly ceiling?: SceneQuality;
  /** The highest tier a probe may reach when only frame intervals are known (beside a game they cannot see its load). */
  readonly blindCeiling?: SceneQuality;
}) {
  const budget = options.budget, ceiling = ORDER.indexOf(options.ceiling ?? 'high');
  const blindCeiling = Math.min(ceiling, ORDER.indexOf(options.blindCeiling ?? options.ceiling ?? 'high'));
  let quality = options.start, proposed: SceneQuality | null = null, reason: string | null = null, steps = 0;
  let samples: GovernorSample[] = [], overSince = 0, underSince = 0, changedAt = -Infinity, judgedAt = -Infinity;
  let probe: { readonly from: SceneQuality; readonly at: number } | null = null, probeWait = UP_MS;
  let measuredBy: GovernorState['measuredBy'] = 'interval', last: GovernorState['p90'] = null;

  function propose(next: SceneQuality, why: string, now: number) {
    if (next === quality) return;
    proposed = next; reason = why; overSince = 0; underSince = 0;
    if (ORDER.indexOf(next) > ORDER.indexOf(quality) && measuredBy === 'interval') probe = { from: quality, at: now };
  }
  return {
    /** Add one drawn frame; returns a proposed quality when a step is due. */
    sample(frame: GovernorSample): SceneQuality | null {
      if (!(frame.intervalMs > 0) || !Number.isFinite(frame.intervalMs)) return proposed;
      samples.push(frame);
      let old = 0;
      while (frame.at - samples[old]!.at > WINDOW_MS) old++;
      if (old) samples.splice(0, old);
      // Judged ten times a second: a 360 Hz display does not pay for a sort every frame.
      if (frame.at - changedAt < SETTLE_MS || samples.length < 20 || frame.at - judgedAt < JUDGE_MS) return proposed;
      judgedAt = frame.at;
      const timed = samples.filter(item => item.gpuMs !== null);
      measuredBy = timed.length >= samples.length * .5 ? 'timer' : 'interval';
      const gpu = measuredBy === 'timer' ? p90(timed.map(item => item.gpuMs!)) : null;
      const cpu = p90(samples.map(item => item.cpuMs)), interval = p90(samples.map(item => item.intervalMs));
      last = { gpuMs: gpu, cpuMs: cpu, intervalMs: interval };
      const over = gpu !== null ? gpu > budget.gpuMs || cpu > budget.cpuMs : interval > budget.intervalMs * MISS;
      const under = gpu !== null ? gpu < budget.gpuMs * .5 && cpu < budget.cpuMs * .5 : interval <= budget.intervalMs * 1.05;
      const index = ORDER.indexOf(quality);
      if (over) {
        underSince = 0; overSince ||= frame.at;
        // A probe that misses is undone at once, and the next probe waits twice as long.
        if (probe && frame.at - probe.at < PROBE_MS + SETTLE_MS) { propose(probe.from, 'probe missed its frame budget', frame.at); probe = null; probeWait = Math.min(probeWait * 2, 160_000); }
        else if (index > 0 && frame.at - overSince >= DOWN_MS) propose(ORDER[index - 1]!, measuredBy === 'timer' ? 'frame cost over budget' : 'frame interval over budget', frame.at);
      } else {
        overSince = 0;
        if (probe && frame.at - probe.at >= PROBE_MS + SETTLE_MS) probe = null;
        if (under && index < (measuredBy === 'timer' ? ceiling : blindCeiling)) {
          underSince ||= frame.at;
          if (frame.at - underSince >= (measuredBy === 'timer' ? UP_MS : probeWait)) propose(ORDER[index + 1]!, measuredBy === 'timer' ? 'frame cost well under budget' : 'probing a higher quality', frame.at);
        } else underSince = 0;
      }
      return proposed;
    },
    /** The host applied the proposed step (at a cut, or after it waited long enough). */
    applied(next: SceneQuality, now: number) {
      if (next !== quality) steps++;
      quality = next; proposed = null; changedAt = now; samples = []; overSince = 0; underSince = 0;
      if (probe) probe = { ...probe, at: now };
    },
    state(): GovernorState { return { quality, proposed, reason, steps, measuredBy, p90: last }; },
  };
}
export type QualityGovernor = ReturnType<typeof createQualityGovernor>;

/**
 * A software rasteriser (SwiftShader, llvmpipe, WARP) is never governed: its frame times say nothing about a
 * person's device, and the evidence captures it draws must keep the quality they asked for.
 */
export function softwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    return /swiftshader|llvmpipe|softpipe|software|basic render driver|microsoft basic/i.test(name);
  } catch { return false; }
}
