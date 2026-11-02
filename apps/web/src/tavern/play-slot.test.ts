import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, TavernPortalSchema, type TavernPortal } from '@chatdom/shared';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT } from '../../../../packages/content/src/tavern/portal';
import type { TavernClient } from './client';
import { tavernPortalDescriptor, tavernVisit, watchTavernDoor, yawRadians, type TavernPortalVisit, type TavernVisitHooks } from './portal';

const kingdomId = KingdomIdSchema.parse('900000004');
const portal: TavernPortal = TavernPortalSchema.parse({ version: 1, id: 'tavern-door', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  source: { placement: 'civic:growth:v1:tavern', collisionRevision: 3 },
  door: { min: [-4.5, .875, -3.05], max: [-3.5, 2.375, -2.25], through: [0, 1] },
  returnAnchor: { feet: [-4, 1.375, -3.625], yaw: 128 }, entry: TAVERN_INTERIOR_ENTRY, exit: TAVERN_INTERIOR_EXIT });

function visit() {
  const calls: string[] = [];
  const v: TavernPortalVisit & { active: boolean; calls: string[] } = { portal, entry: {} as TavernPortalVisit['entry'], endpoint: 'ws://x', active: true, calls,
    leave() { calls.push('leave'); }, fail(reason) { calls.push(`fail:${reason}`); } };
  return v;
}
function fakeClient(script: { leaves?: ('ok' | 'reject')[] } = {}) {
  const leaves = [...(script.leaves ?? ['ok'])];
  const client = { disposed: 0, leaveCalls: 0,
    dispose() { client.disposed++; },
    leave() { client.leaveCalls++; return leaves.shift() === 'reject' ? Promise.reject(new Error('still held')) : Promise.resolve(); } };
  return client;
}
function mount(v: TavernPortalVisit, connect: () => Promise<unknown>) {
  let hooks: TavernVisitHooks | undefined, undrawn = 0;
  const surface = tavernVisit(v, connect as () => Promise<TavernClient>, h => { hooks = h; return () => { undrawn++; }; });
  return { surface, hooks: hooks!, undrawn: () => undrawn };
}

describe('the tavern door for play', () => {
  it('converts the derived portal into play’s descriptor, yaw bytes to radians in the same frame', () => {
    const d = tavernPortalDescriptor(portal);
    expect(d).toMatchObject({ id: 'tavern-door', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern', title: 'The tavern' });
    expect(d.returnAnchor).toEqual({ feet: [-4, 1.375, -3.625], yaw: Math.PI });
    expect(d.entryAnchor.feet).toEqual(TAVERN_INTERIOR_ENTRY.feet);
    expect(d.entryAnchor.yaw).toBeCloseTo(Math.PI);
    expect([0, 64, 192, 256, -64].map(yawRadians)).toEqual([0, Math.PI / 2, Math.PI * 1.5, 0, Math.PI * 1.5]);
    // Facing out from the return anchor is facing against the inward crossing.
    expect(Math.sin(d.returnAnchor.yaw) * portal.door.through[0] + Math.cos(d.returnAnchor.yaw) * portal.door.through[1]).toBeCloseTo(-1);
  });

  it('enters once when the door is walked through, never on arrival outside it', () => {
    let entered = 0;
    const watch = watchTavernDoor(portal, () => { entered++; });
    watch(portal.returnAnchor.feet);
    watch([-4, 1.375, -3.3]);
    expect(entered).toBe(0);
    watch([-4, 1.375, -2.9]);
    watch([-4, 1.375, -2.6]);
    expect(entered).toBe(1);
  });

  it('is ready once the room has placed you, and the interior doorway walks you back out', async () => {
    const v = visit(), client = fakeClient(), { surface, hooks } = mount(v, async () => client);
    await hooks.open(); hooks.onReady(); await surface.ready;
    hooks.leave(); expect(v.calls).toEqual(['leave']);
    await surface.dispose(); expect(client.leaveCalls).toBe(1);
  });

  it('rejects ready when the room never opens, and asks play back outside when it ends later', async () => {
    const early = visit(), first = mount(early, async () => fakeClient());
    first.hooks.onTerminal('The tavern entry has ended');
    await expect(first.surface.ready).rejects.toThrow('The tavern entry has ended');
    expect(early.calls).toEqual([]);
    const late = visit(), second = mount(late, async () => fakeClient());
    await second.hooks.open(); second.hooks.onReady(); await second.surface.ready;
    second.hooks.onTerminal('Your connection ended. Your chair could not be restored.');
    expect(late.calls).toEqual(['fail:Your connection ended. Your chair could not be restored.']);
    // A visit that has ended steers nothing.
    late.active = false; second.hooks.leave(); second.hooks.onTerminal('again');
    expect(late.calls).toHaveLength(1);
  });

  it('resolves dispose only once every connection it opened has let you go, and retries a refused leave', async () => {
    const v = visit(), held = fakeClient({ leaves: ['reject', 'ok'] }), { surface, hooks, undrawn } = mount(v, async () => held);
    await hooks.open(); hooks.onReady();
    await expect(surface.dispose()).rejects.toThrow('still held');
    expect(undrawn()).toBe(1);
    await surface.dispose();
    expect([held.leaveCalls, undrawn()]).toEqual([2, 1]);
  });

  it('leaves a connection that lands after dispose, and opens nothing once disposed', async () => {
    const v = visit(), late = fakeClient();
    let land!: (client: unknown) => void;
    const { surface, hooks } = mount(v, () => new Promise(resolve => { land = resolve; }));
    const opening = hooks.open();
    const disposed = surface.dispose();
    land(late); await opening; await disposed;
    expect([late.disposed, late.leaveCalls]).toEqual([1, 1]);
    await expect(surface.ready).rejects.toThrow();
    await expect(hooks.open()).rejects.toThrow('The tavern visit has ended.');
  });
});
