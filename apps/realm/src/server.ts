import { defineRoom, defineServer } from 'colyseus';
import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { createKingdomRoom } from './kingdom-room';
import type { RealmRoomServices } from './ports';

export function createRealmServer(services: RealmRoomServices) {
  const transport = new uWebSocketsTransport({ maxPayloadLength: 16 * 1024, maxBackpressure: 1024 * 1024, closeOnBackpressureLimit: true });
  const server = defineServer({ greet: false, transport, rooms: { kingdom: defineRoom(createKingdomRoom(services)).filterBy(['kingdomId']) } });
  return { server, transport };
}
