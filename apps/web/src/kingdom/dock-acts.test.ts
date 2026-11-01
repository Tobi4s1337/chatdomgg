import { KingdomIdSchema } from '@chatdom/shared';
import { describe, expect, it, vi } from 'vitest';
import { createDockActs, type DockAct } from './dock-acts';

const act: DockAct = { version: 1, id: 'event:1', actionId: 'action:1', kingdomId: KingdomIdSchema.parse('123'), origin: 'live', kind: 'fire-light', occurredAt: 100, expiresAt: 1000, gate: 'open', fire: 'lit' };

describe('dock act presentation', () => {
  it('witnesses only a visible effect in a successfully drawn frame', () => {
    let visible = false;
    const scene = { begin: vi.fn(() => true), frame: vi.fn(() => visible), end: vi.fn() }, witness = vi.fn();
    const acts = createDockActs(scene, witness);
    expect(acts.receive(act, 100)).toBe(true);
    acts.update(100, true); acts.drawn(); expect(witness).not.toHaveBeenCalled();
    visible = true; acts.update(150, true); expect(witness).not.toHaveBeenCalled();
    acts.drawn(); acts.drawn();
    expect(witness).toHaveBeenCalledOnce();
    expect(witness).toHaveBeenCalledWith({ actionId: 'action:1', kingdomId: '123', origin: 'live', streamEventId: 'event:1' });
    acts.dispose(); expect(scene.end).toHaveBeenCalledOnce();
  });
  it('never witnesses an unavailable or expired subject or a replay', () => {
    const scene = { begin: vi.fn(() => false), frame: vi.fn(() => true), end: vi.fn() }, witness = vi.fn();
    const acts = createDockActs(scene, witness);
    expect(acts.receive(act, 100)).toBe(true);
    acts.update(101, true); acts.drawn();
    expect(acts.receive(act, 102)).toBe(false);
    expect(acts.receive({ ...act, id: 'late' }, 1000)).toBe(false);
    expect(witness).not.toHaveBeenCalled();
  });
  it('does not acknowledge a frame after the scene becomes unavailable', () => {
    const scene = { begin: () => true, frame: () => true, end: vi.fn() }, witness = vi.fn();
    const acts = createDockActs(scene, witness);
    acts.receive(act, 100); acts.update(101, true); acts.update(102, false); acts.drawn();
    expect(witness).not.toHaveBeenCalled(); expect(scene.end).toHaveBeenCalledOnce();
  });
});
