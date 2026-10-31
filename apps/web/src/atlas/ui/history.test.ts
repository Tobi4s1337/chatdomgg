import { describe, expect, it } from 'vitest';
import { CardHistory, type HistoryLike } from './history';

/** A browser history with the same push/replace/back semantics; back() pops asynchronously like the real one. */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [null];
  index = 0;
  pending: (() => void)[] = [];
  constructor(private readonly popstate: () => void) {}
  get state(): unknown {
    return this.entries[this.index];
  }
  pushState(data: unknown): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(structuredClone(data));
    this.index++;
  }
  replaceState(data: unknown): void {
    this.entries[this.index] = structuredClone(data);
  }
  back(): void {
    if (this.index === 0) return;
    this.pending.push(() => {
      this.index--;
      this.popstate();
    });
  }
  /** The user presses the browser's Back button. */
  userBack(): void {
    this.back();
    this.flush();
  }
  flush(): void {
    while (this.pending.length) this.pending.shift()!();
  }
}

function rig() {
  const restored: unknown[] = [];
  const pop = { handler: () => false };
  const history = new FakeHistory(() => pop.handler());
  const card = new CardHistory(history, (view) => restored.push(view));
  pop.handler = () => card.popped();
  return { history, card, restored, pop };
}

const before = { x: 10, y: 20, scale: 1.5 };

describe('CardHistory', () => {
  it('Back closes the card and returns the camera to the view before it opened', () => {
    const { history, card, restored } = rig();
    card.opened('41', before);
    expect(history.entries).toHaveLength(2);
    history.userBack();
    expect(card.isOpen).toBe(false);
    expect(restored).toEqual([before]);
    expect(history.index).toBe(0);
  });

  it('choosing another holding keeps one entry and the original view', () => {
    const { history, card, restored } = rig();
    card.opened('41', before);
    card.opened('42', { x: 99, y: 99, scale: 9 });
    card.opened('43', { x: 7, y: 7, scale: 4 });
    expect(history.entries).toHaveLength(2);
    expect((history.state as { id: string }).id).toBe('43');
    history.userBack();
    expect(restored).toEqual([before]);
  });

  it('closing on the page steps back quietly: no camera restore, and the next Back leaves the map', () => {
    const { history, card, restored } = rig();
    card.opened('41', before);
    card.closed();
    history.flush();
    expect(card.isOpen).toBe(false);
    expect(restored).toEqual([]);
    expect(history.index).toBe(0);
    // A later Back is the page's own, not the card's.
    expect(card.popped()).toBe(false);
  });

  it('a new card opened before the quiet step lands still gets its own entry', () => {
    const { history, card, restored } = rig();
    card.opened('41', before);
    card.closed();
    card.opened('42', { x: 1, y: 2, scale: 3 });
    history.flush();
    expect(card.isOpen).toBe(true);
    expect(restored).toEqual([]);
    history.userBack();
    expect(restored).toEqual([{ x: 1, y: 2, scale: 3 }]);
  });

  it('a popstate that is not the card’s is left to the page', () => {
    const { card } = rig();
    expect(card.popped()).toBe(false);
  });

  it('steps quietly over a card entry left by a reload, so the first Back leaves the map', () => {
    const { history, card, pop } = rig();
    card.opened('a', before);
    // The page reloads on the card's entry: a new CardHistory over the same history, with no card open.
    const restored: unknown[] = [];
    const fresh = new CardHistory(history, (view) => restored.push(view));
    pop.handler = () => fresh.popped();
    fresh.resume();
    history.flush();
    expect(history.index).toBe(0);
    expect(restored).toEqual([]);
    expect(fresh.isOpen).toBe(false);
    // Nothing more to step over, and a later Back is the page's own.
    fresh.resume();
    expect(history.pending).toEqual([]);
    expect(fresh.popped()).toBe(false);
  });
});
