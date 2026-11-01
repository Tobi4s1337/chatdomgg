import { KingdomIdSchema } from '@chatdom/shared';
import { expect, it, vi } from 'vitest';
import type { DockAct } from '../kingdom/dock-acts';
import { createDockPresenter } from './dock-presenter';

it('binds a drawn witness to an event issued to this authenticated connection', async () => {
  let deliver!: (act: DockAct) => void;
  const off = vi.fn(), witness = vi.fn(async () => {}), receive = vi.fn(() => true);
  const presenter = createDockPresenter({ kingdomId: '123', origin: 'live', now: () => 100,
    connection: { subscribe(fn) { deliver = fn; return off; }, witness }, receive });
  const act: DockAct = { version: 1, id: 'event:1', actionId: 'act:1', kingdomId: KingdomIdSchema.parse('123'), origin: 'live', kind: 'gate-open', occurredAt: 90, expiresAt: 1000, gate: 'open', fire: 'unlit' };
  deliver({ ...act, origin: 'simulated' }); expect(receive).not.toHaveBeenCalled();
  deliver(act); expect(receive).toHaveBeenCalledOnce();
  const proof = { actionId: act.actionId, kingdomId: act.kingdomId, origin: act.origin, streamEventId: act.id };
  expect(await presenter.drawn({ ...proof, actionId: 'other' })).toBe(false);
  expect(await presenter.drawn(proof)).toBe(true);
  expect(await presenter.drawn(proof)).toBe(false);
  expect(witness).toHaveBeenCalledOnce();
  presenter.dispose(); expect(off).toHaveBeenCalledOnce();
});
