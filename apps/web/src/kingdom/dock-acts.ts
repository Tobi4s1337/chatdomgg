import { RealmDockPresentationSchema, type RealmDockPresentation, type DockWitness } from '@chatdom/shared/realm';

export type DockAct = RealmDockPresentation;
export type DockActWitness = DockWitness;

/**
 * The host resolves only installed, authorized subjects and plays their authored effects.
 * Returning false means the scene cannot honestly present the requested act. It must not
 * substitute a different target, an unrelated fire, or an unearned spectacle.
 */
export interface DockActScene {
  begin(act: DockAct): boolean;
  /** Called in the existing scene frame before render; true only if the effect is visible. */
  frame(act: DockAct, elapsedMs: number): boolean;
  end(act: DockAct): void;
}

/** No timer or renderer: scene update and actual successful draw drive this session. */
export function createDockActs(scene: DockActScene, witness: (value: DockActWitness) => void) {
  const queued: DockAct[] = [], seen = new Set<string>();
  let current: { act: DockAct; startedAt: number; visible: boolean; witnessed: boolean } | undefined;
  let disposed = false;
  return {
    receive(act: DockAct, now: number): boolean {
      if (disposed || !RealmDockPresentationSchema.safeParse(act).success || !Number.isFinite(now) || now < act.occurredAt || now >= act.expiresAt || seen.has(act.id) || queued.length >= 16) return false;
      seen.add(act.id);
      if (seen.size > 1024) seen.delete(seen.values().next().value!);
      queued.push(act);
      return true;
    },
    /** Call before rendering, after the scene has decided whether the lens is available. */
    update(now: number, available: boolean): void {
      if (disposed || !Number.isFinite(now)) return;
      if (current && (!available || now >= current.act.expiresAt)) {
        scene.end(current.act); current = undefined;
      }
      while (!current && available && queued.length) {
        const act = queued.shift()!;
        if (now >= act.expiresAt || !scene.begin(act)) continue;
        current = { act, startedAt: now, visible: false, witnessed: false };
      }
      if (current) current.visible = available && scene.frame(current.act, Math.max(0, now - current.startedAt));
    },
    /** Call only immediately after the frame containing the act was successfully drawn. */
    drawn(): void {
      if (!current?.visible || current.witnessed || disposed) return;
      current.witnessed = true;
      const { act } = current;
      witness({ actionId: act.actionId, kingdomId: act.kingdomId, origin: act.origin, streamEventId: act.id });
    },
    /** A completed ceremony yields the lens to the existing director. */
    finish(): void { if (current) { scene.end(current.act); current = undefined; } },
    dispose(): void { if (disposed) return; disposed = true; if (current) scene.end(current.act); current = undefined; queued.length = 0; },
  };
}
