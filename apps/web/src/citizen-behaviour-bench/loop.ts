import type { CitizenChatCue, KingdomPresenceFrame } from '@chatdom/shared';
import type { CitizenMotion, CitizenMotionSample } from '@chatdom/world';
import type { CitizenSample } from '../citizens';
// Relative until main adds the policy to the @chatdom/world barrel at merge.
import {
  createCitizenBehaviours, dueBehaviourSteps, type CitizenBehaviourStep, type CitizenGoalAnswer, type CitizenOverlay,
} from '../../../../packages/world/src/citizen-behaviours';

export interface BehaviourLoopSource {
  readonly kingdomId: string;
  readonly epoch: string;
  readonly origin: 'live' | 'simulated';
  /** The latest public frame at a kingdom time; applied before each policy step. */
  frameAt(atMs: number): KingdomPresenceFrame | null;
  /** Slots ambient routines may pose or send anywhere at a kingdom time (walker, royal and reserved slots excluded). */
  ambientAt(atMs: number): ReadonlySet<number>;
  /**
   * Optional gate in front of `motion.requestGoal`, for a labelled simulation of a street closed by
   * main's reserved action. Returning a result answers the goal without asking motion.
   */
  gate?(request: CitizenGoalAnswer['request']): CitizenGoalAnswer['result'] | null;
  /**
   * Chat cues as main's adapter holds them at a step (validated `CitizenChatCue`s, supplied again on every
   * step). In the kingdom consumer this is `[...speech.values()]`; the bench supplies a labelled simulation.
   */
  cuesAt?(atMs: number, samples: readonly CitizenMotionSample[]): readonly CitizenChatCue[];
  /** True on a step at which the caller's source reconnected: the policy is reset, motion carries on. */
  resetsAt?(atMs: number): boolean;
  /** Called when the loop replays from the start, so a stateful simulated source starts again too. */
  restart?(): void;
}

export interface BehaviourFrame {
  readonly samples: readonly CitizenMotionSample[];
  readonly overlays: ReadonlyMap<number, CitizenOverlay>;
}

/**
 * The one caller loop: on fixed kingdom-time steps apply the public frame, sample actual motion,
 * step the policy with main's answers to its previous goals, then forward its new goals to
 * `motion.requestGoal`; at render time sample motion again and present the same timelines.
 * Main reuses this shape in the kingdom consumer at merge, with its own frame and control sources.
 */
export function createBehaviourLoop(motion: CitizenMotion, source: BehaviourLoopSource) {
  const policy = createCitizenBehaviours();
  const destinationsFor = (slot: number) => motion.destinationsForSlot(slot);
  let lastStepMs: number | null = null, answers: CitizenGoalAnswer[] = [], applied: KingdomPresenceFrame | null = null;
  return {
    policy,
    /** Run every fixed step due up to `nowMs`; a long gap yields one step and no replayed backlog. */
    advance(nowMs: number): CitizenBehaviourStep[] {
      const steps: CitizenBehaviourStep[] = [];
      for (const atMs of dueBehaviourSteps(lastStepMs, nowMs)) {
        lastStepMs = atMs;
        // Main's consumer resets its policy when the source reconnects; answers to old goals go with it.
        if (source.resetsAt?.(atMs)) { policy.reset(); answers = []; }
        const frame = source.frameAt(atMs);
        if (frame && frame !== applied) { motion.applyFrame(frame); applied = frame; }
        const samples = motion.sample(atMs), cues = source.cuesAt?.(atMs, samples);
        const step = policy.step({ kingdomId: source.kingdomId, epoch: source.epoch, origin: source.origin, atMs,
          samples, ambientSlots: source.ambientAt(atMs), destinationsFor, answers, ...(cues ? { cues } : {}) });
        answers = step.goals.map(request => ({ request, result: source.gate?.(request) ?? motion.requestGoal(request) }));
        steps.push(step);
      }
      return steps;
    },
    /** Render-time samples plus overlays. Call after `advance(nowMs)`. */
    present(nowMs: number): BehaviourFrame {
      const samples = motion.sample(nowMs);
      return { samples, overlays: policy.present(samples, nowMs) };
    },
    /** Source unavailable, navigation away or a replay from the start. */
    reset(): void { motion.clear(); policy.reset(); lastStepMs = null; answers = []; applied = null; source.restart?.(); },
  };
}

/** Motion plus overlay → the renderer's existing sample fields. Root heading, gait and distance stay main's. */
export function toCitizenSample(sample: CitizenMotionSample, overlay: CitizenOverlay | undefined, look: string): CitizenSample {
  return { id: String(sample.slot), look, position: sample.position, heading: sample.heading, distance: sample.distance,
    moving: Math.min(1, sample.speed / 1.2), speed: sample.speed, opacity: sample.opacity,
    gesture: overlay?.gesture ?? 'none', lookYaw: overlay?.lookYaw ?? 0, time: overlay?.time ?? 0 };
}
