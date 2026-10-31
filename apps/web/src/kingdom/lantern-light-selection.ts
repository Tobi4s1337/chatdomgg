import type { LightFieldSource } from './light-field';

export interface LanternLightCandidate { slot: number; distance: number; source: LightFieldSource }

/** Keep an incumbent through small rank changes, and fade it before reusing its budget slot. */
export function createLanternLightSelection(capacity: number) {
  const selected = new Map<number, { source: LightFieldSource; gain: number }>();
  let previousTime: number | undefined;
  return {
    update(candidates: readonly LanternLightCandidate[], time: number): readonly LightFieldSource[] {
      if (previousTime !== undefined && time < previousTime) { selected.clear(); previousTime = undefined; }
      // Loading frames have no grips yet. They must not consume the initial light state,
      // particularly in a fixed-time capture whose story clock will not advance.
      if (previousTime === undefined && candidates.length === 0) return [];
      const first = previousTime === undefined;
      const dt = previousTime === undefined ? 0 : Math.max(0, time - previousTime);
      previousTime = time;
      const available = new Map(candidates.map(candidate => [candidate.slot, candidate]));
      // A challenger must be appreciably closer; equal-distance crossings cannot chatter.
      const ranked = [...candidates].sort((a, b) =>
        a.distance * (selected.has(a.slot) ? .7 : 1) - b.distance * (selected.has(b.slot) ? .7 : 1) || a.slot - b.slot);
      const wanted = new Set(ranked.slice(0, capacity).map(candidate => candidate.slot));
      for (const [slot, light] of selected) {
        const candidate = available.get(slot);
        if (candidate) light.source = candidate.source;
        light.gain = Math.max(0, Math.min(1, light.gain + (wanted.has(slot) && candidate ? 1 : -1) * dt / .6));
        if (light.gain === 0 && !wanted.has(slot)) selected.delete(slot);
      }
      for (const candidate of ranked) {
        if (selected.size >= capacity) break;
        if (!wanted.has(candidate.slot) || selected.has(candidate.slot)) continue;
        selected.set(candidate.slot, { source: candidate.source, gain: first ? 1 : 0 });
      }
      return [...selected.values()].filter(light => light.gain > 0).map(light => ({
        ...light.source,
        strength: light.source.strength * light.gain * light.gain * (3 - 2 * light.gain),
      }));
    },
    clear() { selected.clear(); previousTime = undefined; },
  };
}
