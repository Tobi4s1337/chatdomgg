import { describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import { createPortalTransfer, type PortalCurtain, type PortalDescriptor, type PortalDestination, type PortalSource, type PortalSurface, type PortalVisit } from './portal';

const kingdomId = '42' as KingdomId;
const door: PortalDescriptor = { id: 'tavern-door', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  entryAnchor: { feet: [1, 0, 2], yaw: 0 }, returnAnchor: { feet: [10, 0, 20], yaw: Math.PI } };

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

/** A world with one log, so every test can read the order of what happened. */
function world(options: { leave?: () => Promise<void>; rejoin?: () => Promise<void>; ready?: Promise<void>; mount?: (visit: PortalVisit) => void } = {}) {
  const log: string[] = [];
  let stranded: (() => void) | null = null;
  const curtain: PortalCurtain = {
    stage: {} as HTMLElement,
    close: async words => { log.push(`curtain closes: ${words.label} / ${words.title}`); },
    open: async note => { log.push(note ? `curtain opens: ${note}` : 'curtain opens'); },
    stranded: retry => { log.push('curtain stranded'); stranded = retry; },
    dispose: () => { log.push('curtain gone'); },
  };
  const source: PortalSource = { kingdomId, entry: { kingdomId, resumeScope: 'scope-0123456789abcdef', ticket: async () => { throw new Error('not here'); } },
    endpoint: 'ws://realm', self: { personId: 'p1', publicName: 'Juniper', lookToken: 'starter-1' }, title: 'Lanternmere',
    leave: options.leave ?? (async () => { log.push('kingdom left'); }),
    rejoin: options.rejoin ?? (async arrival => { log.push(`kingdom joined at ${arrival.anchor.feet.join(',')}`); }) };
  let visit: PortalVisit | null = null;
  const surface: PortalSurface = { ready: options.ready ?? Promise.resolve(), dispose: async () => { log.push('tavern left'); } };
  const destination: PortalDestination = { room: 'tavern', title: 'The tavern',
    mount: (_host, v) => { visit = v; log.push('tavern mounted'); options.mount?.(v); return surface; } };
  const timers = { pending: [] as (() => void)[], set(run: () => void) { this.pending.push(run); return run; }, clear(handle: unknown) { this.pending = this.pending.filter(run => run !== handle); } };
  const cues: string[] = [];
  const transfer = createPortalTransfer({ curtain: () => curtain, cue: name => cues.push(name), timers });
  return { log, source, destination, transfer, timers, cues, visit: () => visit!, retry: () => stranded?.() };
}

describe('a door into a room of its own', () => {
  it('is unavailable without a source for its kingdom or a destination for its room', async () => {
    const w = world();
    expect(w.transfer.available(door)).toBe(false);
    const unbind = w.transfer.bindSource(w.source);
    expect(w.transfer.available(door)).toBe(false);
    w.transfer.registerDestination(w.destination);
    expect(w.transfer.available(door)).toBe(true);
    expect(w.transfer.available({ ...door, kingdomId: '7' as KingdomId })).toBe(false);
    expect(w.transfer.available({ ...door, returnAnchor: { feet: [Number.NaN, 0, 0], yaw: 0 } })).toBe(false);
    unbind();
    expect(w.transfer.available(door)).toBe(false);
    expect(await w.transfer.enter(door)).toBe('unavailable');
    expect(w.log).toEqual([]);
  });

  it('leaves the kingdom before joining the tavern, and reports entry only once the tavern is ready', async () => {
    const ready = deferred();
    const w = world({ ready: ready.promise });
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    const phases: string[] = [];
    w.transfer.onPhase(phase => phases.push(phase));
    const entered = w.transfer.enter(door);
    await flush();
    expect(w.transfer.phase).toBe('joining');
    expect(w.log).toEqual(['curtain closes: Through the door / The tavern', 'kingdom left', 'tavern mounted']);
    expect(w.visit().active).toBe(true);
    expect(w.visit().entry.resumeScope).toBe(w.source.entry.resumeScope);
    ready.resolve();
    expect(await entered).toBe('arrived');
    expect(w.transfer.inside).toEqual(door);
    expect(phases).toEqual(['leaving', 'joining', 'inside']);
    expect(w.cues).toEqual(['door', 'threshold', 'latch']);
    expect(w.log.at(-1)).toBe('curtain opens');
  });

  it('walks back out: the tavern is left before the kingdom is joined, at the door, facing out', async () => {
    const w = world();
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    await w.transfer.enter(door);
    w.log.length = 0;
    const visit = w.visit();
    expect(await w.transfer.leave()).toBe('back-outside');
    expect(w.log).toEqual(['curtain closes: Back out the door / Lanternmere', 'tavern left', 'kingdom joined at 10,0,20', 'curtain opens', 'curtain gone']);
    expect(w.transfer.phase).toBe('idle');
    expect(visit.active).toBe(false);
    // A stale visit cannot steer the next journey.
    visit.leave(); visit.fail('late');
    await flush();
    expect(w.transfer.phase).toBe('idle');
  });

  it('a destination that refuses puts you back outside with one calm line, never reporting entry', async () => {
    const w = world({ ready: Promise.reject(new Error('The tavern could not place your walker.')) });
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await w.transfer.enter(door)).toBe('back-outside');
    error.mockRestore();
    expect(w.log).toEqual(['curtain closes: Through the door / The tavern', 'kingdom left', 'tavern mounted', 'tavern left',
      'kingdom joined at 10,0,20', 'curtain opens: The door would not open just now. You are back outside.', 'curtain gone']);
    expect(w.transfer.inside).toBeNull();
  });

  it('a destination that never answers times out and comes home the same way', async () => {
    const w = world({ ready: new Promise(() => {}) });
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entered = w.transfer.enter(door);
    await flush();
    expect(w.timers.pending).toHaveLength(1);
    w.timers.pending[0]!();
    expect(await entered).toBe('back-outside');
    error.mockRestore();
    expect(w.log).toContain('kingdom joined at 10,0,20');
  });

  it('a destination failing while you are inside (revoked, lost) takes you back outside', async () => {
    const w = world();
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    await w.transfer.enter(door);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    w.visit().fail('session revoked');
    await flush(); await flush();
    error.mockRestore();
    expect(w.transfer.phase).toBe('idle');
    expect(w.log).toContain('curtain opens: The room let you go. You are back outside.');
  });

  it('when the way back is not open it says so and waits for the person, then tries the door again', async () => {
    let attempts = 0;
    const w = world({ rejoin: async () => { attempts++; if (attempts === 1) throw new Error('entry refused'); } });
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    await w.transfer.enter(door);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = w.transfer.leave();
    await flush();
    expect(w.transfer.phase).toBe('stranded');
    expect(w.log.at(-1)).toBe('curtain stranded');
    expect(attempts).toBe(1);
    w.retry();
    expect(await out).toBe('back-outside');
    error.mockRestore();
    expect(attempts).toBe(2);
    expect(w.transfer.phase).toBe('idle');
  });

  it('a kingdom that cannot be left keeps you outside rather than in two rooms', async () => {
    const w = world({ leave: async () => { throw new Error('seat release refused'); } });
    w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await w.transfer.enter(door)).toBe('back-outside');
    error.mockRestore();
    expect(w.log).not.toContain('tavern mounted');
    expect(w.log).toContain('kingdom joined at 10,0,20');
  });

  it('one journey at a time, and the journey keeps the source it started from', async () => {
    const ready = deferred();
    const w = world({ ready: ready.promise });
    const unbind = w.transfer.bindSource(w.source); w.transfer.registerDestination(w.destination);
    const entered = w.transfer.enter(door);
    expect(await w.transfer.enter(door)).toBe('busy');
    unbind();   // the kingdom walk is disposed as the room is left
    ready.resolve();
    expect(await entered).toBe('arrived');
    expect(await w.transfer.leave()).toBe('back-outside');
    expect(w.log).toContain('kingdom joined at 10,0,20');
  });

  it('refuses an unreadable door and a second destination for the same room', () => {
    const w = world();
    w.transfer.registerDestination(w.destination);
    expect(() => w.transfer.registerDestination(w.destination)).toThrow(/already registered/);
    expect(() => w.transfer.registerDestination({ ...w.destination, room: 'kingdom' })).toThrow(/room type of its own/);
    w.transfer.bindSource(w.source);
    expect(w.transfer.available({ ...door, destinationRoom: 'kingdom' })).toBe(false);
    expect(w.transfer.available({ ...door, title: 'x' })).toBe(false);
  });
});
