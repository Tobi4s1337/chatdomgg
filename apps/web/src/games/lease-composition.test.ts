import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWalkLook } from '../walk/input/look';
import { requestBenchGameInput } from '../tavern/bench-input';
import { bindTurnHand } from './turn-input';
import type { GatherTableView } from '@chatdom/shared';

class FakeElement extends EventTarget {
  isContentEditable = false;
  constructor(readonly tagName = 'CANVAS') { super(); }
}
class FakeDocument extends EventTarget {
  pointerLockElement: FakeElement | null = null;
  hidden = false;
  exits = 0;
  exitPointerLock() { this.exits++; this.pointerLockElement = null; this.dispatchEvent(new Event('pointerlockchange')); }
  lock(element: FakeElement) { this.pointerLockElement = element; this.dispatchEvent(new Event('pointerlockchange')); }
}
class FakeCanvas extends FakeElement {
  requests: (() => void)[] = [];
  constructor(private readonly doc: FakeDocument) { super(); }
  requestPointerLock(): Promise<void> {
    return new Promise(resolve => this.requests.push(() => { this.doc.lock(this); resolve(); }));
  }
  resolveRequest(index = 0) { const [resolve] = this.requests.splice(index, 1); if (!resolve) throw new Error('No pending pointer-lock request'); resolve(); }
}
function fixture() {
  const doc = new FakeDocument(), keyboard = new EventTarget();
  vi.stubGlobal('document', doc); vi.stubGlobal('window', keyboard); vi.stubGlobal('HTMLElement', FakeElement);
  const walking = new FakeCanvas(doc), game = new FakeCanvas(doc);
  return { doc, keyboard, walking, game };
}
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, element?: FakeElement) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false });
  if (element) Object.defineProperty(event, 'target', { value: element });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => vi.unstubAllGlobals());

describe('walking and game input composition', () => {
  it('keeps the game canvas locked while walking look is disabled', async () => {
    const { doc, keyboard, walking, game } = fixture();
    const look = createWalkLook(walking, doc, keyboard);
    const lease = requestBenchGameInput(game as unknown as HTMLCanvasElement);
    await Promise.resolve(); game.resolveRequest(); await Promise.resolve();
    expect(doc.pointerLockElement).toBe(game);
    look.setEnabled(false);
    expect(doc.pointerLockElement).toBe(game);
    expect(lease.active).toBe(true);
    lease.release(); look.dispose();
  });

  it('releases a pointer lock that arrives after the game lease ended', async () => {
    const { doc, game } = fixture();
    const lease = requestBenchGameInput(game as unknown as HTMLCanvasElement);
    await Promise.resolve(); lease.release(); game.resolveRequest(); await Promise.resolve(); await Promise.resolve();
    expect(doc.pointerLockElement).toBeNull();
    expect(lease.active).toBe(false);
  });

  it('does not let an old pending request unlock a newer lease on the same canvas', async () => {
    const { doc, game } = fixture();
    const old = requestBenchGameInput(game as unknown as HTMLCanvasElement);
    await Promise.resolve(); old.release();
    const current = requestBenchGameInput(game as unknown as HTMLCanvasElement);
    await Promise.resolve(); game.resolveRequest(1); await Promise.resolve();
    expect(doc.pointerLockElement).toBe(game);
    game.resolveRequest(); await Promise.resolve(); await Promise.resolve();
    expect(doc.pointerLockElement).toBe(game);
    expect(current.active).toBe(true);
    current.release();
  });

  it('captures game keys before the stand handler while E and Escape remain available', () => {
    const { keyboard, game } = fixture();
    const lease = requestBenchGameInput(game as unknown as HTMLCanvasElement, 'pong');
    const received: string[] = [], stand: string[] = [];
    lease.onKey((code, down) => { if (down) received.push(code); });
    keyboard.addEventListener('keydown', event => stand.push((event as KeyboardEvent).code));
    const left = key(keyboard, 'keydown', 'ArrowLeft');
    key(keyboard, 'keydown', 'KeyE'); key(keyboard, 'keydown', 'Escape');
    expect(left.defaultPrevented).toBe(true);
    expect(received).toEqual(['ArrowLeft']);
    expect(stand).toEqual(['KeyE', 'Escape']);
    lease.release();
  });

  it('releases held keys after focus moves to editable fields or a button', () => {
    const { keyboard, game } = fixture();
    const lease = requestBenchGameInput(game as unknown as HTMLCanvasElement, 'pong');
    const received: [string, boolean][] = [];
    lease.onKey((code, down) => received.push([code, down]));
    key(keyboard, 'keydown', 'KeyA'); key(keyboard, 'keyup', 'KeyA', new FakeElement('INPUT'));
    key(keyboard, 'keydown', 'Enter'); key(keyboard, 'keyup', 'Enter', new FakeElement('BUTTON'));
    expect(received).toEqual([['KeyA', true], ['KeyA', false], ['Enter', true], ['Enter', false]]);
    lease.release();
  });

  it('requires a new physical mouse press after a restored lease or blur', async () => {
    const { doc, keyboard, game } = fixture();
    const table = { table: 'hearth', game: 'hearth-dice', status: 'ready', dice: { phase: 'playing', turn: 0, active: [true, true], pot: 2 } } as unknown as GatherTableView;
    const move = vi.fn();
    const bind = async () => {
      const lease = requestBenchGameInput(game as unknown as HTMLCanvasElement, 'hearth-dice:hearth');
      const hand = bindTurnHand(lease, () => ({ table, connected: true, physicalSeat: 0, playerIndex: 0 }), { start: vi.fn(), move });
      game.resolveRequest(); await Promise.resolve();
      return hand;
    };
    const mouse = (type: string, buttons: number, button = 0) => {
      const event = new Event(type); Object.assign(event, { buttons, button, movementX: 1, movementY: 0 }); doc.dispatchEvent(event);
    };
    const old = await bind(); mouse('mousedown', 1); expect(move).toHaveBeenCalledTimes(1); old.dispose();
    const restored = await bind(); mouse('mousemove', 1); expect(move).toHaveBeenCalledTimes(1);
    mouse('mouseup', 0); mouse('mousedown', 1); expect(move).toHaveBeenCalledTimes(2);
    keyboard.dispatchEvent(new Event('blur')); mouse('mousemove', 1); expect(move).toHaveBeenCalledTimes(2);
    // A newly pressed right button must not replay an already held left button.
    mouse('mousedown', 3, 2); expect(move).toHaveBeenCalledTimes(3); expect(move).toHaveBeenLastCalledWith('hold');
    restored.dispose();
  });
});
