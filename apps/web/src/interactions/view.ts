import type { Vec3 } from '@chatdom/shared';
import type { InteractionRecord } from '../../../../packages/world/src/interactions';
import { PENDING, QUIET, SEATED, VERB } from './copy';
import type { InteractionSelection } from './select';
import type { InteractionSnapshot } from './session';

export type PromptTone = 'ready' | 'pending' | 'refused' | 'unavailable' | 'quiet';
/** Everything the carved prompt draws. Built from the selection and the room's answers only. */
export interface PromptView {
  readonly tone: PromptTone;
  /** The one line: a verb, a pending phrase, the room's refusal or the quiet reason. */
  readonly words: string;
  /** Small caption above the verb, e.g. where you are seated. */
  readonly caption: string | null;
  /** True when E or a tap would send something now. */
  readonly actionable: boolean;
  /** The target the prompt stands beside. */
  readonly targetId: string;
  readonly anchor: Vec3;
}
/** The prompt floats this far above the target's authored point. */
export const PROMPT_LIFT = .55;

const lift = (record: InteractionRecord): Vec3 => [record.target.position[0], record.target.position[1] + PROMPT_LIFT, record.target.position[2]];

export function promptView(selection: InteractionSelection, snapshot: InteractionSnapshot, records: readonly InteractionRecord[]): PromptView | null {
  if (!snapshot.connected) return null;
  const phase = snapshot.phase;
  const byId = (id: string) => records.find(record => record.target.id === id);
  if (phase.kind === 'pending') {
    const record = byId(phase.targetId) ?? (snapshot.self.targetId ? byId(snapshot.self.targetId) : undefined);
    return record ? { tone: 'pending', words: PENDING[phase.action], caption: null, actionable: false, targetId: record.target.id, anchor: lift(record) } : null;
  }
  if (phase.kind === 'refused') {
    const record = byId(phase.targetId) ?? selection.focus?.record;
    if (record) return { tone: phase.outcome, words: phase.message, caption: null, actionable: false, targetId: record.target.id, anchor: lift(record) };
  }
  if (selection.focus) {
    const { record, action } = selection.focus;
    const caption = action === 'stand' ? SEATED[record.target.kind] ?? null : null;
    return { tone: 'ready', words: VERB[action], caption, actionable: true, targetId: record.target.id, anchor: lift(record) };
  }
  if (selection.quiet) {
    const { record, reason } = selection.quiet;
    return { tone: 'quiet', words: QUIET[reason], caption: null, actionable: false, targetId: record.target.id, anchor: lift(record) };
  }
  return null;
}
