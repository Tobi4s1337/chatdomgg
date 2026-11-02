import type { LabelRect } from '../labels';
import type { LabelLimits } from './density';
import type { PersonLabel } from './model';
import { BUBBLE_RISE_PX, LABEL_FADE_IN_MS, LABEL_FADE_OUT_MS } from './timing';

/**
 * The label layer's frame-to-frame memory: which names and bubbles are up, where, and how far through their fade.
 * The DOM component only measures elements and writes the transforms this returns, so every rule here is testable
 * without a browser.
 *
 * Placement never moves a label off its head to make room. Labels yield instead, with hysteresis so a crowd at a
 * boundary never flickers:
 * - a label that is up keeps its place while it is only grazed (under a quarter of the smaller label covered), and
 *   even when clearly covered it holds for a short while before it fades;
 * - a label that is down needs clear space with a margin before it may appear;
 * - bubbles come before names, your own name before others, then the nearest first;
 * - a new bubble may push aside other people's name plates (never another bubble or your own name), and the
 *   speaker's own name plate always: a walker's bubble is its own label beside their name, eased in over it.
 */

export interface LabelSize { readonly width: number; readonly height: number }
export interface StagedLabel {
  readonly id: string;
  readonly person: PersonLabel;
  /** This frame's layout decision. A label that is not shown may still be fading out. */
  readonly shown: boolean;
  /** The label body's top-left corner in the layer's CSS pixels; a bubble's tail hangs below it to the anchor. */
  readonly left: number;
  readonly top: number;
  readonly opacity: number;
  /** Fully faded and no longer a candidate: the host may drop its element. */
  readonly removed: boolean;
}
export interface LabelStageInput {
  readonly people: readonly PersonLabel[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly reserved?: readonly LabelRect[];
  readonly limits: LabelLimits;
  readonly reducedMotion: boolean;
  readonly now: number;
  /** Measured body size of a person's element (without the bubble tail), or undefined before it is measured. */
  readonly size: (person: PersonLabel) => LabelSize | undefined;
}

/** The bubble's tail reaches this far below its body; its tip is the anchor. */
export const BUBBLE_TAIL_PX = 7;
/** A label that is down needs this much clear space around it before it appears. */
export const NEW_LABEL_CLEARANCE_PX = 10;
/** A label that is up tolerates being covered by up to this fraction of the smaller of the two. */
export const KEEP_OVERLAP_FRACTION = .25;
/** A label that is up and clearly covered holds this long before it yields. */
export const OVERLAP_HOLD_MS = 450;
/** A label whose person drops out of the frame for a moment keeps its place this long. */
export const MISSING_GRACE_MS = 250;
const EDGE_MARGIN_PX = 8;
/** Range slack for a label that is already up, so walking along the range limit does not flicker. */
const RANGE_SLACK_M = 2;

interface Record {
  person: PersonLabel;
  /** Holds a place in the layout (an incumbent). */
  shown: boolean;
  seenFrame: number;
  /** Placed in the most recent frame. */
  chosen: boolean;
  progress: number;
  rising: boolean;
  overlapSince: number | null;
  lastSeen: number;
  left: number;
  top: number;
}

interface Candidate { readonly record: Record; readonly person: PersonLabel; readonly speaking: boolean; readonly bounds: LabelRect }

const area = (r: LabelRect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
function coveredFraction(a: LabelRect, b: LabelRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  return w * h / Math.max(1, Math.min(area(a), area(b)));
}
const near = (a: LabelRect, b: LabelRect, pad: number) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const easeOut = (t: number) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

export function createLabelStage() {
  const records = new Map<string, Record>();
  let lastNow: number | undefined, frameNumber = 0;

  function frame(input: LabelStageInput): StagedLabel[] {
    const { viewport, limits, now } = input;
    const dt = lastNow === undefined ? 0 : Math.max(0, Math.min(100, now - lastNow));
    lastNow = now;
    const current = ++frameNumber;
    const valid = viewport.width > 16 && viewport.height > 16;
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const person of input.people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      let record = records.get(person.id);
      if (!record) { record = { person, shown: false, seenFrame: current, chosen: false, progress: 0, rising: false, overlapSince: null, lastSeen: now, left: 0, top: 0 }; records.set(person.id, record); }
      record.person = person; record.lastSeen = now; record.seenFrame = current;
      const size = input.size(person);
      const speaking = !!person.speech?.length;
      const opacity = person.opacity ?? 1, visibility = person.visibility ?? 1;
      if (!size || !(size.width > 0 && size.height > 0) || ![person.x, person.y, person.distance].every(Number.isFinite)) continue;
      const tail = speaking ? BUBBLE_TAIL_PX : 0;
      const bounds = { left: person.x - size.width / 2, right: person.x + size.width / 2, top: person.y - size.height - tail, bottom: person.y };
      // Follow the anchor even while fading out (a home bubble going behind a wall fades where the home is).
      record.left = bounds.left; record.top = bounds.top;
      if (!valid || person.distance < 0 || !(opacity >= .1) || !(visibility >= .5) || (!speaking && !person.name)) continue;
      candidates.push({ record, person, speaking, bounds });
    }
    candidates.sort((a, b) => Number(b.speaking) - Number(a.speaking) || Number(b.person.self) - Number(a.person.self)
      || a.person.distance - b.person.distance || (a.person.id < b.person.id ? -1 : a.person.id > b.person.id ? 1 : 0));

    const accepted: Candidate[] = [], decided = new Set<Candidate>();
    let names = 0, bubbles = 0;
    const room = (c: Candidate) => c.speaking ? bubbles < limits.bubbles.count : names < limits.names.count;
    const take = (c: Candidate) => { accepted.push(c); if (c.speaking) bubbles++; else names++; c.record.shown = true; };
    const drop = (c: Candidate) => { c.record.shown = false; c.record.overlapSince = null; };
    const range = (c: Candidate) => c.speaking ? limits.bubbles.range : limits.names.range;
    const inside = (r: LabelRect, margin: number) => r.left >= margin && r.top >= margin && r.right <= viewport.width - margin && r.bottom <= viewport.height - margin;
    const reserved = input.reserved ?? [];

    // Labels that are up keep their places first.
    for (const c of candidates) {
      if (!c.record.shown) continue;
      decided.add(c);
      if (c.person.distance > range(c) + RANGE_SLACK_M || !inside(c.bounds, 0) || !room(c)) { drop(c); continue; }
      const covered = Math.max(0, ...accepted.map(other => coveredFraction(c.bounds, other.bounds)), ...reserved.map(rect => coveredFraction(c.bounds, rect)));
      // The hold timer runs while clearly covered and only resets once the label is well clear again, so a label
      // jittering across the threshold cannot hold its place forever by touching the line every other frame.
      if (covered > KEEP_OVERLAP_FRACTION) c.record.overlapSince ??= now;
      else if (covered < KEEP_OVERLAP_FRACTION / 2) c.record.overlapSince = null;
      if (c.record.overlapSince !== null && now - c.record.overlapSince > OVERLAP_HOLD_MS) { drop(c); continue; }
      take(c);
    }
    // Then new labels, nearest first, only into clear space.
    for (const c of candidates) {
      if (decided.has(c)) continue;
      if (c.person.distance > range(c) || !inside(c.bounds, EDGE_MARGIN_PX) || !room(c)
        || reserved.some(rect => near(c.bounds, rect, NEW_LABEL_CLEARANCE_PX))) continue;
      const blockers = accepted.filter(other => near(c.bounds, other.bounds, NEW_LABEL_CLEARANCE_PX));
      if (blockers.length) {
        // A person's own name plate always yields to their own bubble, yours too.
        const own = (other: Candidate) => c.person.walkerId !== undefined && other.person.walkerId === c.person.walkerId;
        if (!c.speaking || blockers.some(other => !own(other) && (other.speaking || other.person.self))) continue;
        for (const other of blockers) { accepted.splice(accepted.indexOf(other), 1); names--; drop(other); }
      }
      take(c);
      c.record.overlapSince = null;
    }
    const chosen = new Set(accepted.map(c => c.record));

    const staged: StagedLabel[] = [];
    for (const [id, record] of records) {
      const chosenNow = chosen.has(record), seenNow = record.seenFrame === current;
      record.chosen = chosenNow;
      // Seen but not placed: the place is given up. Missing for a moment: the place is kept for the grace period,
      // though the label already fades, so a walker stepping behind a post does not lose their slot.
      if ((seenNow && !chosenNow) || now - record.lastSeen > MISSING_GRACE_MS) { record.shown = false; record.overlapSince = null; }
      const previous = record.progress;
      record.progress = chosenNow ? Math.min(1, previous + dt / LABEL_FADE_IN_MS) : Math.max(0, previous - dt / LABEL_FADE_OUT_MS);
      record.rising = chosenNow && record.progress < 1 && (record.rising || previous === 0);
      const removed = !seenNow && now - record.lastSeen > MISSING_GRACE_MS && record.progress === 0;
      if (removed) records.delete(id);
      const speaking = !!record.person.speech?.length;
      const rise = speaking && record.rising && !input.reducedMotion ? BUBBLE_RISE_PX * (1 - easeOut(record.progress)) : 0;
      staged.push({ id, person: record.person, shown: chosenNow, left: record.left, top: record.top + rise,
        opacity: smooth(record.progress) * Math.max(0, Math.min(1, record.person.opacity ?? 1)), removed });
    }
    return staged;
  }

  return {
    frame,
    /** True while any label is between states, so the host keeps stepping even when no scene frame arrives. */
    get animating() {
      for (const record of records.values()) if (record.progress !== (record.chosen ? 1 : 0) || record.seenFrame !== frameNumber) return true;
      return false;
    },
    clear() { records.clear(); lastNow = undefined; },
  };
}
