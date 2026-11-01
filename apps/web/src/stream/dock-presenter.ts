import { RealmDockPresentationSchema, type RealmDockStageState } from '@chatdom/shared/realm';
import type { DockAct, DockActWitness } from '../kingdom/dock-acts';

/** The connection is authenticated by its server, not by fields in the event. */
export interface DockPresentationConnection {
  subscribe(receive: (act: DockAct) => void): () => void;
  subscribeState?(receive: (state: RealmDockStageState) => void): () => void;
  witness(value: DockActWitness): Promise<void>;
}

/** Tie an authenticated stream connection to a particular realm and a visible scene. */
export function createDockPresenter(options: {
  kingdomId: string;
  origin: 'live' | 'simulated';
  connection: DockPresentationConnection;
  receive: (act: DockAct, now: number) => boolean;
  now?: () => number;
}) {
  let disposed = false;
  const issued = new Map<string, DockAct>();
  const off = options.connection.subscribe(act => {
    if (disposed || !RealmDockPresentationSchema.safeParse(act).success || act.kingdomId !== options.kingdomId || act.origin !== options.origin) return;
    if (options.receive(act, (options.now ?? Date.now)())) {
      issued.set(act.id, act);
      if (issued.size > 1024) issued.delete(issued.keys().next().value!);
    }
  });
  return {
    /** Called by the scene only after its visible act has been drawn. */
    async drawn(value: DockActWitness): Promise<boolean> {
      const act = issued.get(value.streamEventId);
      if (disposed || !act || act.actionId !== value.actionId || act.kingdomId !== value.kingdomId || act.origin !== value.origin) return false;
      try { await options.connection.witness(value); issued.delete(value.streamEventId); return true; }
      catch { return false; }
    },
    dispose(): void { if (disposed) return; disposed = true; issued.clear(); off(); },
  };
}
