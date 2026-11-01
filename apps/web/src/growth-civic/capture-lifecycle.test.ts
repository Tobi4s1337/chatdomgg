import { describe, expect, it, vi } from 'vitest';

// The capture script is plain JavaScript, so load its module at runtime.
const modulePath = './capture-lifecycle.mjs';
const { captureEach } = await import(modulePath) as {
  captureEach: (items: string[], operations: {
    acquire: () => Promise<() => Promise<void>>;
    capture: (item: string) => Promise<void>;
  }) => Promise<void>;
};

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('captureEach', () => {
  it('holds a separate lock for each of six stills and the contact sheet, waiting for release before reacquiring', async () => {
    const items = ['still-1', 'still-2', 'still-3', 'still-4', 'still-5', 'still-6', 'contact-sheet'];
    const captures = items.map(() => gate());
    const releases = items.map(() => gate());
    const events: string[] = [];
    let held = false;
    let index = 0;
    const acquire = vi.fn(async () => {
      expect(held).toBe(false);
      held = true;
      const current = index++;
      events.push(`acquire:${current}`);
      return async () => {
        events.push(`release-start:${current}`);
        await releases[current]!.promise;
        held = false;
        events.push(`release-end:${current}`);
      };
    });
    const capture = vi.fn(async (item: string) => {
      const current = items.indexOf(item);
      expect(held).toBe(true);
      events.push(`capture:${item}`);
      await captures[current]!.promise;
    });
    const running = captureEach(items, { acquire, capture });
    for (let i = 0; i < items.length; i++) {
      await flush();
      expect(acquire).toHaveBeenCalledTimes(i + 1);
      expect(capture).toHaveBeenCalledTimes(i + 1);
      expect(capture).toHaveBeenLastCalledWith(items[i]);
      captures[i]!.open();
      await flush();
      expect(events.at(-1)).toBe(`release-start:${i}`);
      expect(acquire).toHaveBeenCalledTimes(i + 1);
      releases[i]!.open();
    }
    await running;
    expect(held).toBe(false);
    expect(events).toEqual(items.flatMap((item, i) => [
      `acquire:${i}`, `capture:${item}`, `release-start:${i}`, `release-end:${i}`,
    ]));
  });

  it('releases a failed capture and propagates its error without starting the next item', async () => {
    const failure = new Error('capture failed');
    const releaseGate = gate();
    const release = vi.fn(async () => { await releaseGate.promise; });
    const acquire = vi.fn(async () => release);
    const capture = vi.fn(async () => { throw failure; });
    const running = captureEach(['bad', 'later'], { acquire, capture });
    const result = running.catch(error => error);
    await flush();
    expect(release).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    let settled = false;
    void result.then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    releaseGate.open();
    expect(await result).toBe(failure);
    expect(acquire).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('bad');
  });

  it('propagates acquisition failure without capturing or starting another acquisition', async () => {
    const failure = new Error('lock unavailable');
    const acquire = vi.fn(async (): Promise<() => Promise<void>> => { throw failure; });
    const capture = vi.fn(async () => {});
    await expect(captureEach(['first', 'later'], { acquire, capture })).rejects.toBe(failure);
    expect(acquire).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalled();
  });

  it('stops the sequence if releasing a lock fails', async () => {
    const failure = new Error('lock release failed');
    const acquire = vi.fn(async () => async () => { throw failure; });
    const capture = vi.fn(async () => {});
    await expect(captureEach(['first', 'later'], { acquire, capture })).rejects.toBe(failure);
    expect(acquire).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('first');
  });
});
