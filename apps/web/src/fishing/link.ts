import { FISHING_CHANNEL, SHELF_CHANNEL, type FishingChannelReply, type FishingChannelRequest, type ItemReply, type ItemRequest, type ShelfReply,
  type ShelfRequest } from '@chatdom/shared';

/** The retained walking room's own typed message surface. Never a second socket. */
export interface ChannelRoom {
  onMessage(type: string, listener: (message: unknown) => void): (() => void) | void;
  send(type: string, payload: unknown): void;
}

export interface ChannelLink<Request, Reply> {
  send(request: Request): void;
  subscribe(listener: (reply: Reply) => void): () => void;
  dispose(): void;
}

function channel<Request, Reply>(room: ChannelRoom, type: string): ChannelLink<Request, Reply> {
  const listeners = new Set<(reply: Reply) => void>();
  let closed = false;
  const remove = room.onMessage(type, message => {
    if (closed || !message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return;
    for (const listener of [...listeners]) {
      try { listener(message as Reply); } catch (error) { console.error('A pier listener failed.', error); }
    }
  });
  return {
    send(request) { if (!closed) room.send(type, request); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (closed) return; closed = true; listeners.clear(); if (typeof remove === 'function') remove(); },
  };
}

export type FishingLink = ChannelLink<FishingChannelRequest, FishingChannelReply>;
export type ItemLink = ChannelLink<ItemRequest, ItemReply>;
export const fishingLink = (room: ChannelRoom): FishingLink => channel(room, FISHING_CHANNEL);
export const itemLink = (room: ChannelRoom): ItemLink => channel(room, 'items');
export type ShelfLink = ChannelLink<ShelfRequest, ShelfReply>;
export const shelfLink = (room: ChannelRoom): ShelfLink => channel(room, SHELF_CHANNEL);

let counter = 0;
/** Request ids match the server's `[A-Za-z0-9_.:-]{1,64}`. */
export function requestId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}.${Date.now().toString(36)}.${counter.toString(36)}`;
}
