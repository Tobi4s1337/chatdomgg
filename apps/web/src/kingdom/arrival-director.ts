import type { KingdomPresenceFrame } from '@chatdom/shared';
import type { CitizenMotionSample } from '@chatdom/world';

const RECENT_ARRIVAL_MS = 5_000;
const MAX_ATTENTION_MS = 40_000;
const WINDOW_HOLD_MS = 6_000;

export interface ArrivalAttention {
  readonly slot: number;
  readonly phase: 'walking' | 'window';
  /** Supplied by the caller so witnessed walker feet remain the drawn subject. */
  readonly subject: CitizenMotionSample;
}

interface Selection {
  slot: number;
  since: number;
  selectedAtMs: number;
  trigger: 'arrival' | 'chat';
  windowEndsAtMs?: number;
}

/** Local camera attention only. Observations never write presence, speech or world state. */
export function createArrivalDirector() {
  let frame: KingdomPresenceFrame | undefined;
  let present = new Map<number, number>();
  // One timestamp per public slot, including absent slots, prevents heartbeat/reappearance replay.
  const seen = new Map<number, number>();
  let selected: Selection | undefined;

  const cancel = () => { selected = undefined; };
  const clear = () => { cancel(); frame = undefined; present.clear(); seen.clear(); };
  const expire = (nowMs: number) => {
    if (selected && (!Number.isFinite(nowMs) || nowMs < selected.selectedAtMs
      || nowMs - selected.selectedAtMs >= MAX_ATTENTION_MS
      || (selected.windowEndsAtMs !== undefined && nowMs >= selected.windowEndsAtMs)
      || present.get(selected.slot) !== selected.since)) cancel();
  };

  return {
    /** Full accepted projection; a new epoch/kingdom/origin starts a new observation baseline. */
    observe(next: KingdomPresenceFrame, nowMs: number) {
      if (!Number.isFinite(nowMs)) { clear(); return; }
      const sameSource = frame && next.kingdomId === frame.kingdomId && next.epoch === frame.epoch && next.origin === frame.origin;
      if (sameSource && next.sequence <= frame!.sequence) return;
      if (frame && (!sameSource || next.asOf < frame.asOf)) clear();
      frame = next;
      present = new Map(next.windows.filter(window => window.present).map(window => [window.slot, window.since]));
      expire(nowMs);
      if (next.connection === 'stale') cancel();

      let arrival: { slot: number; since: number } | undefined;
      for (const [slot, since] of present) {
        const newStay = seen.get(slot) !== since;
        seen.set(slot, since);
        if (!newStay || nowMs < since || nowMs - since > RECENT_ARRIVAL_MS) continue;
        // The newest observed arrival wins one idle shot; other arrivals are consumed, never queued.
        if (!arrival || since > arrival.since || (since === arrival.since && slot < arrival.slot)) arrival = { slot, since };
      }
      if (!selected && next.connection !== 'stale' && arrival) selected = { ...arrival, selectedAtMs: nowMs, trigger: 'arrival' };
    },
    /** Caller must first validate the actual cue's source, timestamp, expiry and public slot. */
    chat(slot: number, nowMs: number) {
      expire(nowMs);
      const since = present.get(slot);
      if (!Number.isFinite(nowMs) || !frame || frame.connection === 'stale' || selected || since === undefined || since > nowMs) return;
      selected = { slot, since, selectedAtMs: nowMs, trigger: 'chat' };
    },
    sample(nowMs: number, subjectForSlot: (slot: number) => CitizenMotionSample | undefined): ArrivalAttention | undefined {
      expire(nowMs);
      if (!selected) return;
      const subject = subjectForSlot(selected.slot);
      if (!subject || subject.slot !== selected.slot || subject.state === 'leaving') { cancel(); return; }
      const window = subject.homeLit && subject.homeLitAtMs !== null && Number.isFinite(subject.homeLitAtMs) && subject.homeLitAtMs <= nowMs;
      if (window && selected.windowEndsAtMs === undefined) {
        const start = selected.trigger === 'chat' ? Math.max(subject.homeLitAtMs!, selected.selectedAtMs) : subject.homeLitAtMs!;
        selected.windowEndsAtMs = start + WINDOW_HOLD_MS;
        expire(nowMs);
        if (!selected) return;
      }
      return { slot: selected.slot, phase: window ? 'window' : 'walking', subject };
    },
    /** User camera gestures stop this shot without replaying the same observed arrival. */
    cancel,
    /** Authority loss/navigation also forgets the accepted source. */
    clear,
  };
}
