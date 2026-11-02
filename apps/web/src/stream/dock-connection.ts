import { KingdomIdSchema } from '@chatdom/shared';
import { RealmDockPresentationSchema, RealmDockStageStateSchema, RealmSessionReplySchema, type RealmDockStageState } from '@chatdom/shared/realm';
import type { DockAct, DockActWitness } from '../kingdom/dock-acts';
import type { DockPresentationConnection } from './dock-presenter';

/** Display is public. Only a broadcaster-session stream can receive the private draw acknowledgement capability. */
export function createDockConnection(kingdomId: string, options: { readonly readOnly?: boolean } = {}): DockPresentationConnection & { dispose(): void } {
  KingdomIdSchema.parse(kingdomId);
  const listeners = new Set<(act: DockAct) => void>();
  const states = new Set<(state: RealmDockStageState) => void>();
  const seen = new Set<string>();
  const pending = new Map<string, DockAct>();
  const deliver = (act: DockAct) => {
    if (seen.has(act.id) || act.expiresAt <= Date.now()) return;
    if (!listeners.size) { pending.set(act.id, act); if (pending.size > 16) pending.delete(pending.keys().next().value!); return; }
    seen.add(act.id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
    for (const receive of listeners) receive(act);
  };
  let snapshot: RealmDockStageState | undefined;
  let source: EventSource | undefined, token: string | undefined, disposed = false;
  function open() {
    if (source || disposed) return;
    source = new EventSource(`/api/dock/presentations?kingdom=${encodeURIComponent(kingdomId)}`, { withCredentials: true });
    source.addEventListener('presenter', message => {
      token = undefined;
      if (options.readOnly) return;
      try { const value: unknown = JSON.parse((message as MessageEvent<string>).data);
        if (value && typeof value === 'object' && 'presenterToken' in value && typeof value.presenterToken === 'string'
          && /^[A-Za-z0-9_-]{32,192}$/.test(value.presenterToken)) token = value.presenterToken;
      } catch { /* A malformed grant never turns into authority. */ }
    });
    source.addEventListener('state', message => {
      try { const parsed = RealmDockStageStateSchema.safeParse(JSON.parse((message as MessageEvent<string>).data));
        if (parsed.success && parsed.data.kingdomId === kingdomId && (!snapshot || parsed.data.asOf >= snapshot.asOf)) {
          snapshot = parsed.data; for (const receive of states) receive(snapshot);
        }
      } catch { /* A state checkpoint cannot become a ceremony. */ }
    });
    source.addEventListener('presentation', message => {
      try { const parsed = RealmDockPresentationSchema.safeParse(JSON.parse((message as MessageEvent<string>).data));
        if (parsed.success && parsed.data.kingdomId === kingdomId) deliver(parsed.data);
      } catch { /* Ignore malformed public stage directions. */ }
    });
    source.onerror = () => { token = undefined; };
  }
  return {
    subscribe(receive) { if (disposed) return () => {}; listeners.add(receive); open(); for (const act of pending.values()) deliver(act); pending.clear(); return () => {
      listeners.delete(receive); if (!listeners.size && !states.size) { source?.close(); source = undefined; token = undefined; }
    }; },
    subscribeState(receive) { if (disposed) return () => {}; states.add(receive); if (snapshot) receive(snapshot); open(); return () => {
      states.delete(receive); if (!states.size && !listeners.size) { source?.close(); source = undefined; token = undefined; }
    }; },
    async witness(value: DockActWitness) {
      if (options.readOnly) throw new Error('This view only observes royal acts.');
      const grant = token;
      if (!grant || disposed || value.kingdomId !== kingdomId || document.visibilityState === 'hidden') throw new Error('This stream has no active presentation grant.');
      const response = await fetch('/api/realm/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Sign in to confirm a royal act on stream.');
      const session = RealmSessionReplySchema.parse(await response.json());
      if (session.status !== 'authenticated' || token !== grant || disposed) throw new Error('The presenter session changed.');
      const acknowledged = await fetch('/api/dock/witness', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify({ kingdomId, streamEventId: value.streamEventId, presenterToken: grant }) });
      if (!acknowledged.ok) throw new Error('The kingdom did not confirm this presentation.');
      const body: unknown = await acknowledged.json();
      if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'witnessed') throw new Error('The kingdom could not verify the draw.');
    },
    dispose() { disposed = true; source?.close(); source = undefined; token = undefined; listeners.clear(); states.clear(); snapshot = undefined; seen.clear(); pending.clear(); },
  };
}
