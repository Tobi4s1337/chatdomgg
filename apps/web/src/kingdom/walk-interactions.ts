import type { RealmBootstrap, RealmPrivateMessage, RealmTransientMessage } from '@chatdom/shared/realm';
import { createInteractionSession } from '../interactions/session';
import type { InteractionFeedback } from '../interactions/ports';

interface LifecycleSignal { (listener: () => void): unknown; remove(listener: () => void): void }

export interface WalkInteractionRoom {
  onMessage<T>(type: string, callback: (message: T) => void): () => void;
  send(type: string, payload?: unknown): void;
  readonly state: { readonly writerEpoch: string };
  readonly onDrop: LifecycleSignal;
  readonly onLeave: LifecycleSignal;
  readonly onReconnect: LifecycleSignal;
}

/** Same retained room as movement. Bootstrap restores truth; a dropped transport owns no actionable prompt. */
export function bindWalkInteractions(room: WalkInteractionRoom, feedback?: InteractionFeedback) {
  let disposed = false;
  let ownedPlotId: string | null = null;
  const session = createInteractionSession({ realm: { send: intent => room.send('intent', intent) }, clock: () => performance.now(),
    ...(feedback ? { feedback } : {}) });
  const connect = () => { if (!disposed && room.state.writerEpoch) session.connect(room.state.writerEpoch); };
  const disconnect = () => { ownedPlotId = null; session.disconnect(); };
  const reconnect = () => { connect(); if (!disposed) room.send('bootstrap'); };
  const stopPrivate = room.onMessage('private', (message: RealmPrivateMessage) => {
    if (message.type === 'receipt' || message.type === 'interaction') session.receive(message);
    else if (message.type === 'home.owned') ownedPlotId = message.plotId;
  });
  const stopTransient = room.onMessage('transient', (message: RealmTransientMessage) => {
    if (message.type === 'seats') session.receive(message);
  });
  const stopBootstrap = room.onMessage('bootstrap', (message: RealmBootstrap) => {
    if (!disposed && message.writerEpoch === room.state.writerEpoch) session.connect(message.writerEpoch);
  });
  room.onDrop(disconnect); room.onLeave(disconnect); room.onReconnect(reconnect);
  connect();
  // The entry observer may already have consumed join's private snapshot before the walking renderer mounted.
  // Ask this same room to repeat its checkpoint and private self state; never infer it from public geometry.
  room.send('bootstrap');
  return {
    session,
    get ownedPlotId() { return ownedPlotId; },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopPrivate(); stopTransient(); stopBootstrap();
      room.onDrop.remove(disconnect); room.onLeave.remove(disconnect); room.onReconnect.remove(reconnect);
      session.disconnect();
    },
  };
}
