import type { KingdomPresenceFrame } from '@chatdom/shared';
import type { CitizenMotion, CitizenMotionSample } from '@chatdom/world';
import type { CitizenSample } from '../citizens';
// Relative until main adds the policy to the @chatdom/world barrel at merge.
import {
  createCitizenBehaviours, dueBehaviourSteps, type CitizenBehaviourStep, type CitizenOverlay,
} from '../../../../packages/world/src/citizen-behaviours';

export interface BehaviourLoopSource {
  readonly kingdomId: string;
  readonly epoch: string;
  readonly origin: 'live' | 'simulated';
  /** The latest public frame at a kingdom time; applied before each policy step. */
  frameAt(atMs: number): KingdomPresenceFrame | null;
  /** Slots ambient routines may pose at a kingdom time (walker, royal and reserved slots excluded). */
  ambientAt(atMs: number): ReadonlySet<number>;
}

export interface BehaviourFrame {
  readonly samples: readonly CitizenMotionSample[];
  readonly overlays: ReadonlyMap<number, CitizenOverlay>;
}

/**
 * The one caller loop: on fixed kingdom-time steps apply the public frame, sample actual motion
 * and step the policy; at render time sample motion again and present the same timelines.
 * Main reuses this shape in the kingdom consumer at merge, with its own frame and control sources.
 */
export function createBehaviourLoop(motion: CitizenMotion, source: BehaviourLoopSource) {
  const policy = createCitizenBehaviours();
  let lastStepMs: number | null = null;
  return {
    policy,
    /** Run every fixed step due up to `nowMs`; a long gap yields one step and no replayed backlog. */
    advance(nowMs: number): CitizenBehaviourStep[] {
      const steps: CitizenBehaviourStep[] = [];
      for (const atMs of dueBehaviourSteps(lastStepMs, nowMs)) {
        lastStepMs = atMs;
        const frame = source.frameAt(atMs);
        if (frame) motion.applyFrame(frame);
        steps.push(policy.step({ kingdomId: source.kingdomId, epoch: source.epoch, origin: source.origin, atMs,
          samples: motion.sample(atMs), ambientSlots: source.ambientAt(atMs) }));
      }
      return steps;
    },
    /** Render-time samples plus overlays. Call after `advance(nowMs)`. */
    present(nowMs: number): BehaviourFrame {
      const samples = motion.sample(nowMs);
      return { samples, overlays: policy.present(samples, nowMs) };
    },
    /** Source unavailable, navigation away or a replay from the start. */
    reset(): void { motion.clear(); policy.reset(); lastStepMs = null; },
  };
}

/** Motion plus overlay → the renderer's existing sample fields. Root heading, gait and distance stay main's. */
export function toCitizenSample(sample: CitizenMotionSample, overlay: CitizenOverlay | undefined, look: string): CitizenSample {
  return { id: String(sample.slot), look, position: sample.position, heading: sample.heading, distance: sample.distance,
    moving: Math.min(1, sample.speed / 1.2), opacity: sample.opacity,
    gesture: overlay?.gesture ?? 'none', lookYaw: overlay?.lookYaw ?? 0, time: overlay?.time ?? 0 };
}
