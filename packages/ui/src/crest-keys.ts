/**
 * Roving focus for a row of crest seals. Arrows walk the row and wrap, Home and End jump to its ends, and a
 * resting crest is skipped. Moving focus never chooses: Space or Enter on the focused crest does (native button
 * activation), so walking past a realm never sends anyone there.
 */
export type CrestKey = 'ArrowRight' | 'ArrowDown' | 'ArrowLeft' | 'ArrowUp' | 'Home' | 'End';

export function isCrestKey(key: string): key is CrestKey {
  return key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

/** The index focus moves to, or `from` itself when nothing else can take it. `open[i]` is false for a resting crest. */
export function crestStep(key: CrestKey, from: number, open: readonly boolean[]): number {
  const count = open.length;
  if (!count) return from;
  if (key === 'Home' || key === 'End') {
    const order = Array.from({ length: count }, (_, i) => key === 'Home' ? i : count - 1 - i);
    return order.find(i => open[i]) ?? from;
  }
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  for (let n = 1; n <= count; n++) {
    const i = ((from + step * n) % count + count) % count;
    if (open[i]) return i;
  }
  return from;
}

/** The crest that holds the group's single tab stop: the chosen one, else the first that can be chosen. */
export function crestTabStop(chosen: number, open: readonly boolean[]): number {
  if (chosen >= 0 && open[chosen]) return chosen;
  const first = open.indexOf(true);
  return first >= 0 ? first : Math.max(0, chosen);
}
