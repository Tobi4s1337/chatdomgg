import { defineRoom, defineServer } from 'colyseus';
import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { createKingdomRoom } from './kingdom-room';
import { RealmDiagnostics } from './diagnostics';
import { REALM_TRANSPORT_LIMITS } from './limits';
import type { RealmRoomServices } from './ports';

/** The uWS transport with its open sockets readable for backpressure sampling (`getBufferedAmount` only). */
export class RealmTransport extends uWebSocketsTransport {
  get sockets(): Iterable<{ getBufferedAmount(): number }> { return this.clients; }
}

/**
 * The realm's WebSocket server. Inbound frames are capped at 16 KiB (bounded build operations fit); outbound bytes
 * per socket at 1 MiB, past which uWS drops the send and closes the socket, so no decoder is left silently stale
 * (the client reconnects and receives full state). Rates and seats are enforced by the kingdom room.
 */
export function createRealmServer(services: RealmRoomServices, diagnostics: RealmDiagnostics = new RealmDiagnostics()) {
  const transport = new RealmTransport({
    maxPayloadLength: REALM_TRANSPORT_LIMITS.maxPayloadLength,
    maxBackpressure: REALM_TRANSPORT_LIMITS.maxBackpressure,
    closeOnBackpressureLimit: REALM_TRANSPORT_LIMITS.closeOnBackpressureLimit,
    dropped: ws => {
      let buffered = 0;
      try { buffered = ws.getBufferedAmount(); } catch { /* already closed: nothing left buffered */ }
      diagnostics.dropped(buffered);
    },
  });
  const server = defineServer({ greet: false, transport, rooms: { kingdom: defineRoom(createKingdomRoom(services, diagnostics)).filterBy(['kingdomId']) } });
  // Sampling timers are unref'd; Colyseus keeps one onShutdown callback, which belongs to the composition (main.ts).
  diagnostics.watch({ sockets: () => transport.sockets });
  return { server, transport, diagnostics };
}
