/**
 * Heads turn toward the monarch (Artstyle-Soul-Feel.md §8). The kingdom scene provides the turn; whoever draws
 * walkers (the walk, the stream's observed walkers) spreads `walkerGaze(pose)` into the citizen sample. Without a
 * provider, or for a walker who keeps their own pose, it adds nothing.
 */
export interface GazePose { readonly id: string; readonly x: number; readonly z: number; /** The room's yaw byte. */ readonly yaw: number }
type Provider = (pose: GazePose) => number | undefined;

let provider: Provider | null = null;

/** One scene at a time owns the gaze; the returned function withdraws it. */
export function provideWalkerGaze(next: Provider): () => void {
  provider = next;
  return () => { if (provider === next) provider = null; };
}

/** `{ lookYaw }` in radians relative to the body, or nothing. */
export function walkerGaze(pose: GazePose): { lookYaw?: number } {
  if (!provider) return {};
  const yaw = provider(pose);
  return yaw === undefined || !Number.isFinite(yaw) ? {} : { lookYaw: yaw };
}
