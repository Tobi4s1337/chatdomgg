import { expect, it } from 'vitest';
import { DockOutcomeSchema, RealmDockActionRequestSchema, RealmDockPresentationSchema, RealmDockWitnessRequestSchema } from './dock';

it('keeps actor authority private and requires an independent presentation witness for success', () => {
  const principal = { personId: '129634568', sessionId: '60d6558b-a890-4c79-a46f-6e398a348ba6' };
  const action = { id: 'royal:one', kingdomId: '129634568', kind: 'gate-open', expectedRevision: 'dock:1' };
  expect(RealmDockActionRequestSchema.parse({ version: 1, origin: 'live', principal, action }).action).toEqual(action);
  expect(RealmDockActionRequestSchema.safeParse({ version: 1, origin: 'live', principal: { ...principal, role: 'broadcaster' }, action }).success).toBe(false);
  const event = { version: 1, id: 'stage:one', actionId: action.id, kingdomId: action.kingdomId, origin: 'live', kind: action.kind,
    occurredAt: 1_793_537_000_000, expiresAt: 1_793_537_015_000, gate: 'open', fire: 'unlit' };
  expect(RealmDockPresentationSchema.parse(event)).toEqual(event);
  expect(RealmDockPresentationSchema.safeParse({ ...event, principal }).success).toBe(false);
  expect(RealmDockPresentationSchema.safeParse({ ...event, expiresAt: event.occurredAt + 60_001 }).success).toBe(false);
  expect(DockOutcomeSchema.safeParse({ status: 'accepted', message: 'The gate opened.', receipt: 'receipt:one' }).success).toBe(false);
  const witness = { actionId: action.id, kingdomId: action.kingdomId, origin: 'live', streamEventId: event.id };
  expect(DockOutcomeSchema.parse({ status: 'accepted', message: 'The gate opened.', receipt: 'receipt:one', witness }).witness).toEqual(witness);
  expect(RealmDockWitnessRequestSchema.safeParse({ version: 1, principal, kingdomId: action.kingdomId, origin: 'live', streamEventId: event.id }).success).toBe(false);
});

it('requires a directed undo and keeps citizen subjects off gate and fire undo', () => {
  const undo = { version: 1, id: 'stage:undo', actionId: 'royal:undo', kingdomId: '129634568', origin: 'live', kind: 'undo',
    occurredAt: 1_793_537_000_000, expiresAt: 1_793_537_015_000, gate: 'closed', fire: 'unlit', undoOf: 'stage:one' };
  expect(RealmDockPresentationSchema.safeParse(undo).success).toBe(false);
  expect(RealmDockPresentationSchema.safeParse({ ...undo, undoSubject: { kind: 'gate-open' } }).success).toBe(true);
  expect(RealmDockPresentationSchema.safeParse({ ...undo, undoSubject: { kind: 'gate-open', targetSlot: 1 } }).success).toBe(false);
  expect(RealmDockPresentationSchema.safeParse({ ...undo, undoSubject: { kind: 'citizen-crown', targetSlot: 1,
    restoredHonour: { kind: 'citizen-knight', expiresAt: 1_793_538_000_000 } } }).success).toBe(true);
  expect(RealmDockPresentationSchema.safeParse({ ...undo, kind: 'gate-open', undoSubject: { kind: 'gate-open' } }).success).toBe(false);
});
