import { describe, expect, it } from 'vitest';
import type { RealmInteractionState } from '@chatdom/shared/realm';
import { createInteractionSession, PENDING_LIMIT_MS, REFUSAL_MS } from '../interactions/session';
import { createRetainedSeatRestore } from './retained-seat';

const TARGET = 'tavern-chair';
const SEATED: RealmInteractionState = { revision: 1, mode: 'seated', targetId: TARGET, plotId: null };

function setup() {
  let now = 0;
  const session = createInteractionSession({ realm: { send() {} }, clock: () => now, nextId: () => 'pending-seat' });
  const restore = createRetainedSeatRestore();
  session.connect('epoch-one');
  const bootstrap = (state = SEATED) => {
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'epoch-one', state });
    restore.witness(state);
  };
  return { session, restore, bootstrap, tick(time: number) { now = time; session.tick(now); } };
}

describe('retained tavern chair restoration', () => {
  it.each(['applied', 'refused', 'unanswered'] as const)('keeps a seated bootstrap armed through a duplicate sit that is %s', outcome => {
    const { session, restore, bootstrap, tick } = setup();
    expect(session.request(TARGET, 'tavern')).toBe(true);
    bootstrap();
    expect(session.snapshot().phase.kind).toBe('pending');
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();

    if (outcome === 'applied') {
      session.receive({ type: 'receipt', receipt: { version: 1, id: 'pending-seat', status: 'applied', writerEpoch: 'epoch-one', state: SEATED } });
    } else {
      if (outcome === 'refused') session.receive({ type: 'receipt', receipt: { version: 1, id: 'pending-seat', status: 'refused', message: 'You are already seated.' } });
      else tick(PENDING_LIMIT_MS);
      expect(session.snapshot().phase.kind).toBe('refused');
      expect(restore.next(session.snapshot(), 'walking')).toBeNull();
      tick((outcome === 'unanswered' ? PENDING_LIMIT_MS : 0) + REFUSAL_MS);
    }

    expect(session.snapshot().phase.kind).toBe('idle');
    expect(restore.next(session.snapshot(), 'walking')).toEqual({ requestId: 'restored-seat', targetId: TARGET, action: 'tavern', state: SEATED });
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it('retains a witnessed private chair until the session becomes connected', () => {
    const { session, restore, bootstrap } = setup();
    bootstrap();
    session.disconnect();
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    session.connect('epoch-one');
    expect(restore.next(session.snapshot(), 'walking')?.targetId).toBe(TARGET);
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it.each([
    { revision: 1, mode: 'standing' as const, targetId: null, plotId: null },
    { revision: 1, mode: 'interior' as const, targetId: TARGET, plotId: null },
    { revision: 1, mode: 'seated' as const, targetId: null, plotId: null },
  ])('clears a bootstrap with mode $mode and target $targetId before any future abandoned chair', state => {
    const { session, restore, bootstrap } = setup();
    bootstrap();
    bootstrap({ ...state, revision: 2 });
    expect(session.request(TARGET, 'tavern')).toBe(true);
    session.abandon();
    session.receive({ type: 'receipt', receipt: { version: 1, id: 'pending-seat', status: 'applied', writerEpoch: 'epoch-one', state: { ...SEATED, revision: 3 } } });
    expect(session.snapshot().self.mode).toBe('seated');
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it('requires a witnessed bootstrap rather than adopting an ordinary authoritative chair', () => {
    const { session, restore } = setup();
    session.receive({ type: 'interaction', requestId: 'ordinary-request', writerEpoch: 'epoch-one', state: SEATED });
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it('pins the bootstrap target and cannot restore an ordinary later seat at another table', () => {
    const { session, restore, bootstrap } = setup();
    bootstrap();
    session.receive({ type: 'interaction', requestId: 'ordinary-seat', writerEpoch: 'epoch-one', state: { ...SEATED, revision: 2, targetId: 'other-chair' } });
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    session.receive({ type: 'interaction', requestId: 'ordinary-return', writerEpoch: 'epoch-one', state: { ...SEATED, revision: 3 } });
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it.each(['pending', 'refused', 'unanswered'] as const)('cancels a seated bootstrap for an explicit stand that is %s, including after returning idle', outcome => {
    const { session, restore, bootstrap, tick } = setup();
    bootstrap();
    expect(session.request(TARGET, 'stand')).toBe(true);
    if (outcome === 'refused') session.receive({ type: 'receipt', receipt: { version: 1, id: 'pending-seat', status: 'refused', message: 'The chair is unavailable.' } });
    if (outcome === 'unanswered') tick(PENDING_LIMIT_MS);
    expect(session.snapshot().phase.kind).toBe(outcome === 'pending' ? 'pending' : 'refused');
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    if (outcome === 'pending') session.abandon();
    else tick((outcome === 'unanswered' ? PENDING_LIMIT_MS : 0) + REFUSAL_MS);
    expect(session.snapshot().phase.kind).toBe('idle');
    expect(session.snapshot().self).toEqual(SEATED);
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it('clears on drop so a late applied receipt cannot restore the abandoned camera', () => {
    const { session, restore, bootstrap } = setup();
    session.request(TARGET, 'tavern');
    bootstrap();
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    restore.clear();
    session.disconnect();
    session.connect('epoch-one');
    session.receive({ type: 'receipt', receipt: { version: 1, id: 'pending-seat', status: 'applied', writerEpoch: 'epoch-one', state: { ...SEATED, revision: 2 } } });
    expect(session.snapshot().self.mode).toBe('seated');
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });

  it('defers a witnessed chair while the camera is released or playing and restores once walking resumes', () => {
    const { session, restore, bootstrap } = setup();
    bootstrap();
    expect(restore.next(session.snapshot(), 'released')).toBeNull();
    expect(restore.next(session.snapshot(), 'playing')).toBeNull();
    expect(restore.next(session.snapshot(), 'walking')?.state).toBe(session.snapshot().self);
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
    bootstrap({ ...SEATED, revision: 2 });
    restore.clear(); restore.clear();
    expect(restore.next(session.snapshot(), 'walking')).toBeNull();
  });
});
