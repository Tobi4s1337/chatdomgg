/** The play owner's input lease. A game consumes it; it never replaces the walking controller. */
export interface GameInputLease {
  readonly active: boolean;
  onKey(listener: (code: string, down: boolean) => void): () => void;
  onPointer(listener: (dx: number, dy: number, buttons: number) => void): () => void;
  release(): void;
}
export interface PongHand {
  readonly target: () => number;
  readonly aim: (value: number, now: number) => void;
  readonly start: () => void;
}
/** Pointer and keyboard are expressed from this chair's view; both seats use the same public board. */
export function bindPongHand(lease: GameInputLease, seat: 0 | 1, hand: PongHand, clock: () => number) {
  const keys = new Set<string>(), sign = seat === 0 ? -1 : 1;
  const offKey = lease.onKey((code, down) => {
    if (down) keys.add(code); else keys.delete(code);
    if (down && (code === 'Enter' || code === 'Space')) hand.start();
  });
  const offPointer = lease.onPointer(dx => { if (lease.active) hand.aim(hand.target() + dx * .003 * sign, clock()); });
  return {
    frame(dt: number, now: number) {
      if (!lease.active) { keys.clear(); return; }
      const direction = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      if (direction) hand.aim(hand.target() + direction * sign * Math.min(.1, dt) * 2.6, now);
    },
    dispose() { keys.clear(); offKey(); offPointer(); lease.release(); },
  };
}
