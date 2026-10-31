import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { STANDING, createInteractionRegistry, interactionTargetId } from '../../../../packages/world/src/interactions';
import type { InteractIntent } from './ports';
import { selectInteraction } from './select';
import { createInteractionSession } from './session';

const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
const worldOf = (solids: readonly SolidBox[]): CollisionWorld => ({ revision: 1, query: q => solids.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) });
const LOG = interactionTargetId.campfireSeat('t', 'log'), ANVIL = interactionTargetId.anvil('t');
const GROUND = box([-20, -1, -20], [20, 0, 20]);
const placements = [{ source: 'test', origin: [0, 0, 0] as Vec3, turn: 0 as const, cell: 1 as const, anchors: [
  { id: LOG, kind: 'campfire-seat' as const, zone: 'street', position: [-1.5, .4, 0] as Vec3, approach: [-1.5, 0, .7] as Vec3, rest: [-1.5, .4, 0] as Vec3, reach: 1.8 },
  { id: ANVIL, kind: 'anvil' as const, zone: 'street', position: [1.5, .8, 0] as Vec3, approach: [1.5, 0, .8] as Vec3, reach: 1.8 },
] }];
const actor = { walkerId: 'w', zone: 'street', state: STANDING, ownedPlotId: null };

describe('the browser only hints, and never takes back what it let go', () => {
  it('follows the look between two reachable targets, and drops one the moment a wall hides it', () => {
    const open = worldOf([GROUND]);
    const records = createInteractionRegistry({ layoutRevision: 'a', world: open, placements }).records;
    const at = (forward: Vec3, previous: string | null, world = open) => selectInteraction({ frame: { feet: [0, 0, 0], forward }, records, world, actor, seats: [], previous }).focus?.record.target.id ?? null;
    expect(at([-1, -.3, 0], null)).toBe(LOG);
    expect(at([1, -.3, 0], LOG)).toBe(ANVIL);
    // 38° off the log: kept while it was the focus (hysteresis), not chosen fresh.
    const slanted: Vec3 = [-Math.cos(38 * Math.PI / 180), 0, Math.sin(38 * Math.PI / 180)];
    expect(at(slanted, LOG)).toBe(LOG);
    expect(at(slanted, null)).toBe(null);
    // A wall between eye and log: never kept, whatever the last frame chose.
    const walled = worldOf([GROUND, box([-.9, 0, -1], [-.7, 3, 1])]);
    expect(at([-1, -.3, 0], LOG, walled)).toBe(null);
    // Someone on the log: a quiet line, never the actionable prompt.
    const taken = selectInteraction({ frame: { feet: [0, 0, 0], forward: [-1, 0, 0] }, records, world: open, actor, seats: [{ targetId: LOG, walkerId: 'other', generation: 1, status: 'occupied' }], previous: null });
    expect(taken).toMatchObject({ focus: null, quiet: { reason: 'occupied' } });
  });

  it('sends one request per press, and a late acceptance after Escape updates state without retaking the camera', () => {
    let now = 0;
    const sent: InteractIntent[] = [];
    const session = createInteractionSession({ realm: { send: intent => { sent.push(intent); } }, clock: () => now });
    const accepted: string[] = [];
    session.onAccepted(a => { accepted.push(a.requestId); });
    expect(session.request(LOG, 'sit')).toBe(false);       // not connected: nothing is sent
    session.connect('epoch-1');
    expect(session.request(LOG, 'sit')).toBe(true);
    expect(session.snapshot().phase.kind).toBe('pending'); // at once, before any reply
    expect(session.request(LOG, 'sit')).toBe(false);       // a repeat while pending sends nothing
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ version: 1, type: 'interact', id: sent[0]!.id, targetId: LOG, action: 'sit' });

    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[0]!.id, status: 'applied', writerEpoch: 'epoch-old', state: STANDING } });
    expect(session.snapshot().phase.kind).toBe('pending');
    expect(accepted).toEqual([]);
    session.abandon();
    const state = { revision: 1, mode: 'seated' as const, targetId: LOG, plotId: null };
    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[0]!.id, status: 'applied', writerEpoch: 'epoch-1', state } });
    expect(accepted).toEqual([]);
    expect(session.snapshot().self).toEqual(state);
    // An older self state arriving late, or one from another writer epoch, changes nothing.
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'epoch-1', state: { ...state, revision: 0, mode: 'standing', targetId: null } });
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'epoch-0', state: { ...state, revision: 9, mode: 'standing', targetId: null } });
    expect(session.snapshot().self).toEqual(state);

    // A refusal is the room's sentence, and it fades back to the look.
    now = 100;
    expect(session.request(LOG, 'stand')).toBe(true);
    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[1]!.id, status: 'refused', message: 'Stand up first.' } });
    expect(session.snapshot().phase).toMatchObject({ kind: 'refused', message: 'Stand up first.' });
    session.tick(100 + 3200);
    expect(session.snapshot().phase.kind).toBe('idle');
    session.disconnect();
    expect(session.request(LOG, 'stand')).toBe(false);
  });
});
