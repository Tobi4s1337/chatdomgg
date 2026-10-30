/** Review state for the forge-mood bench. Only presentation inputs; there is no request to describe. */
export interface ForgeRefusalBenchState {
  /** Which line of the shared pool the simulated public beat carries. */
  variant: 0 | 1 | 2;
  /** Fixed hour of the light grade; 19 is the kingdom's dusk. */
  hour: number;
  /** Seconds since the beat was admitted, or null for a live, button-driven preview. */
  at: number | null;
}

export function parseForgeRefusalBench(search: string): ForgeRefusalBenchState {
  const query = new URLSearchParams(search);
  const variant = Number(query.get('variant') ?? 0);
  const hour = Number(query.get('hour') ?? 19);
  const rawAt = query.get('t');
  const at = rawAt === null || rawAt === '' ? null : Number(rawAt);
  return {
    variant: variant === 1 || variant === 2 ? variant : 0,
    hour: Number.isFinite(hour) ? Math.min(24, Math.max(0, hour)) : 19,
    at: at !== null && Number.isFinite(at) ? Math.max(0, at) : null,
  };
}
