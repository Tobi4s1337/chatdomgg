import { expect, it } from 'vitest';
import { bindWalkInteractions, type WalkInteractionRoom } from './walk-interactions';

function signal() {
  const listeners = new Set<() => void>();
  return Object.assign((listener: () => void) => { listeners.add(listener); }, {
    remove(listener: () => void) { listeners.delete(listener); },
    emit() { for (const listener of listeners) listener(); },
    get size() { return listeners.size; },
  });
}

it('restores mounted interactions from the retained room, drops transport ownership and removes all delivery listeners', () => {
  const messages = new Map<string, Set<(message: never) => void>>(), sent: { type: string; payload?: unknown }[] = [];
  const onDrop = signal(), onLeave = signal(), onReconnect = signal();
  const room: WalkInteractionRoom = { state: { writerEpoch: 'writer-1' }, onDrop, onLeave, onReconnect,
    onMessage(type, listener) { const list = messages.get(type) ?? new Set(); list.add(listener); messages.set(type, list); return () => { list.delete(listener); }; },
    send(type, payload) { sent.push({ type, payload }); },
  };
  const emit = (type: string, payload: unknown) => { for (const listener of messages.get(type) ?? []) listener(payload as never); };
  const binding = bindWalkInteractions(room), accepted: string[] = [];
  binding.session.onAccepted(value => accepted.push(value.targetId));
  expect(sent).toEqual([{ type: 'bootstrap', payload: undefined }]);
  emit('private', { type: 'home.owned', plotId: 'p1' });
  expect(binding.ownedPlotId).toBe('p1');
  emit('private', { type: 'interaction', requestId: null, writerEpoch: 'writer-1',
    state: { revision: 3, mode: 'interior', targetId: 'home:p1:door', plotId: 'p1' } });
  emit('transient', { type: 'seats', writerEpoch: 'writer-1', revision: 1, seats: [{ targetId: 'fire:site:seat:a', walkerId: 'peer', generation: 1, status: 'occupied' }] });
  expect(binding.session.snapshot()).toMatchObject({ self: { mode: 'interior', revision: 3 }, seats: [{ walkerId: 'peer' }] });
  expect(binding.session.request('anvil:market', 'forge')).toBe(true);
  const request = sent.at(-1)!.payload as { id: string };
  onDrop.emit();
  expect(binding.ownedPlotId).toBeNull();
  emit('private', { type: 'receipt', receipt: { version: 1, id: request.id, status: 'applied', writerEpoch: 'writer-1',
    state: { revision: 4, mode: 'standing', targetId: null, plotId: null } } });
  expect(binding.session.snapshot().connected).toBe(false);
  expect(accepted).toEqual([]);
  onReconnect.emit();
  expect(binding.session.snapshot().connected).toBe(true);
  binding.dispose();
  expect([...messages.values()].every(list => list.size === 0)).toBe(true);
  expect(onDrop.size + onLeave.size + onReconnect.size).toBe(0);
  expect(binding.session.snapshot().connected).toBe(false);
});
