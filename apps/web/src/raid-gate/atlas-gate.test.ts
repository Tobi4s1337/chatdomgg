import { describe, expect, it, vi } from 'vitest';
import type { AtlasRaid, KingdomId } from '../../../api/src/raid-gate/contracts';
import { deferGateAtlas, gateAtlasBundled, mountGateAtlas, type GateAtlasModules } from './atlas-gate';
import type { AtlasGateEvent, AtlasGateHost } from './ports';

const EMBED = '../atlas/embed.ts';
const SOURCE = '129634568' as KingdomId;
const el = {} as HTMLElement;

function fakeGate() {
  const listeners = new Set<(event: AtlasGateEvent) => void>();
  const calls: string[] = [];
  const gate: AtlasGateHost = {
    origin: 'live',
    open: from => { calls.push(`open:${from}`); },
    close: () => { calls.push('close'); },
    resolve: async kingdomId => { calls.push(`resolve:${kingdomId}`); return null; },
    subscribe: (listener, signal) => { listeners.add(listener); signal.addEventListener('abort', () => listeners.delete(listener)); },
    follow: raid => { calls.push(`follow:${raid.id}`); },
    travel: stage => { calls.push(`travel:${stage.kind}`); },
  };
  return { gate, calls, emit: (event: AtlasGateEvent) => { for (const listener of listeners) listener(event); } };
}

function embed(gate: AtlasGateHost | null) {
  const dispose = vi.fn();
  const mountAtlas = vi.fn<(el: HTMLElement, options: { mode: 'gate'; signal: AbortSignal }) => { gate: AtlasGateHost | null; dispose: () => void }>(() => ({ gate, dispose }));
  let release!: () => void;
  const loaded = new Promise<void>(resolve => { release = resolve; });
  const modules: GateAtlasModules = { [EMBED]: async () => { await loaded; return { mountAtlas }; } };
  return { modules, mountAtlas, dispose, release };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('mountGateAtlas', () => {
  it('answers null without the Atlas embed in the build', async () => {
    expect(gateAtlasBundled({})).toBe(false);
    expect(await mountGateAtlas(el, new AbortController().signal, {})).toBeNull();
    expect(deferGateAtlas(() => el, new AbortController().signal, {})).toBeNull();
  });

  it('mounts gate mode, returns its gate and disposes the map when the signal ends', async () => {
    const { gate } = fakeGate();
    const atlas = embed(gate);
    atlas.release();
    const life = new AbortController();
    expect(gateAtlasBundled(atlas.modules)).toBe(true);
    expect(await mountGateAtlas(el, life.signal, atlas.modules)).toBe(gate);
    expect(atlas.mountAtlas).toHaveBeenCalledWith(el, { mode: 'gate', signal: life.signal });
    expect(atlas.dispose).not.toHaveBeenCalled();
    life.abort();
    expect(atlas.dispose).toHaveBeenCalled();
  });

  it('does not mount when the signal ends while the module loads', async () => {
    const atlas = embed(fakeGate().gate);
    const life = new AbortController();
    const mounted = mountGateAtlas(el, life.signal, atlas.modules);
    life.abort();
    atlas.release();
    expect(await mounted).toBeNull();
    expect(atlas.mountAtlas).not.toHaveBeenCalled();
  });

  it('answers null for a module that fails to load, is not the embed, or offers no gate', async () => {
    const signal = new AbortController().signal;
    expect(await mountGateAtlas(el, signal, { [EMBED]: () => Promise.reject(new Error('offline')) })).toBeNull();
    expect(await mountGateAtlas(el, signal, { [EMBED]: async () => ({ somethingElse: true }) })).toBeNull();
    const gateless = embed(null);
    gateless.release();
    expect(await mountGateAtlas(el, signal, gateless.modules)).toBeNull();
    expect(gateless.dispose).toHaveBeenCalled();
  });
});

describe('deferGateAtlas', () => {
  it('mounts nothing until the board needs the map', async () => {
    const atlas = embed(fakeGate().gate);
    atlas.release();
    const host = deferGateAtlas(() => el, new AbortController().signal, atlas.modules)!;
    host.subscribe(() => undefined, new AbortController().signal);
    await flush();
    expect(atlas.mountAtlas).not.toHaveBeenCalled();
    expect(host.origin).toBe('live');
  });

  it('opens the finder once the map is up, keeps call order and forwards the map\'s events', async () => {
    const fake = fakeGate();
    const atlas = embed(fake.gate);
    const life = new AbortController();
    const place = vi.fn(() => el);
    const host = deferGateAtlas(place, life.signal, atlas.modules)!;
    const heard: AtlasGateEvent[] = [];
    host.subscribe(event => heard.push(event), life.signal);
    host.open(SOURCE, life.signal);
    host.follow({ id: 'raid-1' } as AtlasRaid, life.signal);
    host.travel?.({ kind: 'rise', ticket: 't', from: SOURCE, to: '22' as KingdomId, state: 'reserved' }, life.signal);
    expect(fake.calls).toEqual([]);
    atlas.release();
    await flush();
    expect(atlas.mountAtlas).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([`open:${SOURCE}`, 'follow:raid-1', 'travel:rise']);
    fake.emit({ kind: 'closed' });
    expect(heard).toEqual([{ kind: 'closed' }]);
    expect(await host.resolve('22' as KingdomId, life.signal)).toBeNull();
    expect(fake.calls.at(-1)).toBe('resolve:22');
    life.abort();
    expect(atlas.dispose).toHaveBeenCalled();
  });

  it('lets a close before the map is up cancel the pending open', async () => {
    const fake = fakeGate();
    const atlas = embed(fake.gate);
    const life = new AbortController();
    const host = deferGateAtlas(() => el, life.signal, atlas.modules)!;
    host.open(SOURCE, life.signal);
    host.close();
    atlas.release();
    await flush();
    expect(fake.calls).toEqual([]);
  });

  it('tells listeners the finder closed when the map cannot load, and tries again on the next need', async () => {
    let attempts = 0;
    const fake = fakeGate();
    const modules: GateAtlasModules = { [EMBED]: async () => {
      attempts++;
      if (attempts === 1) throw new Error('chunk failed');
      return { mountAtlas: () => ({ gate: fake.gate, dispose: () => undefined }) };
    } };
    const life = new AbortController();
    const host = deferGateAtlas(() => el, life.signal, modules)!;
    const heard: AtlasGateEvent[] = [];
    host.subscribe(event => heard.push(event), life.signal);
    host.open(SOURCE, life.signal);
    await flush();
    expect(heard).toEqual([{ kind: 'closed' }]);
    host.open(SOURCE, life.signal);
    await flush();
    expect(attempts).toBe(2);
    expect(fake.calls).toEqual([`open:${SOURCE}`]);
  });
});
