import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import { RealmDockPresentationSchema, type DockAction, type RealmDockPresentation } from '@chatdom/shared/realm';
import type { DockPresentationConnection } from './dock-presenter';

/** Development stream bench only; this has no command or authority transport. */
export function createDockFixture(): DockPresentationConnection & {
  kingdomId: typeof WORLD_FIXTURE_KINGDOM;
  trigger(kind: DockAction['kind'], targetSlot?: number): void;
} {
  const listeners = new Set<(act: RealmDockPresentation) => void>();
  let serial = 0;
  return {
    kingdomId: WORLD_FIXTURE_KINGDOM,
    subscribe(receive) { listeners.add(receive); return () => { listeners.delete(receive); }; },
    async witness() { throw new Error('A picture rehearsal has no realm receipt.'); },
    trigger(kind, targetSlot) {
      const at = Date.now();
      const event = RealmDockPresentationSchema.parse({ version: 1, id: `simulated:dock:${++serial}`, actionId: `simulated:press:${serial}`,
        kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', kind, occurredAt: at, expiresAt: at + 60_000,
        gate: kind === 'gate-close' ? 'closed' : 'open', fire: kind === 'fire-light' ? 'lit' : 'unlit',
        ...(targetSlot !== undefined ? { targetId: `simulated:citizen:${targetSlot}`, targetSlot } : {}),
        ...(kind === 'moment-play' ? { targetId: 'sky-dusk', moment: 'sky-dusk' } : {}),
      });
      for (const receive of listeners) receive(event);
    },
  };
}
