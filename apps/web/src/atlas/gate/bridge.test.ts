// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AtlasChannel, KingdomId } from '@chatdom/shared';
import type { AtlasGateEvent, AtlasGateHost, AtlasTravelStage } from '../../raid-gate/ports';
import type { AtlasRaid } from '../../../../api/src/raid-gate/contracts';
import { gateBridge, type AtlasHandle, type AtlasReadyState, type AtlasScene, type AtlasSceneGate } from '../embed';

// `handle.gate` is raid-show's port exactly: this line fails to compile if either side drifts.
type GateOfHandle = NonNullable<AtlasHandle['gate']>;
const _exact: (gate: GateOfHandle) => AtlasGateHost = gate => gate;
void _exact;

const FROM = '41245072' as KingdomId;
const TO = '12826' as KingdomId;
const channel: AtlasChannel = { kingdomId: TO, login: 'twitch', displayName: 'Twitch', language: 'en', founded: false, kingdomName: null, contentClassification: 'unknown' };

function fakeScene() {
  const calls: string[] = [];
  const gate: AtlasSceneGate = {
    open: (from) => void calls.push(`open:${from}`),
    close: () => void calls.push('close'),
    resolve: async (id) => (id === TO ? { channel, land: 'waiting' } : null),
    follow: (raid) => void calls.push(`follow:${raid.id}`),
    travel: (stage) => void calls.push(`travel:${stage.kind}`),
  };
  const scene = { gate } as unknown as AtlasScene;
  return { calls, scene };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const raid = { id: 'raid-7', fromKingdomId: FROM, toKingdomId: TO, observedAt: 1, viewers: 3 } as unknown as AtlasRaid;
const stage = (kind: AtlasTravelStage['kind']) => ({ kind, ticket: 't', from: FROM, to: TO, state: 'travelling' }) as unknown as AtlasTravelStage;

describe('the gate bridge', () => {
  it('is live, and holds calls made before the map is drawn: the latest open, then follow and travel in order', async () => {
    const { calls, scene } = fakeScene();
    let mounted: AtlasScene | null = null;
    const loaded = deferred<void>();
    const ready = deferred<AtlasReadyState>();
    const { host } = gateBridge(() => mounted, loaded.promise, ready.promise, () => false);
    expect(host.origin).toBe('live');
    const signal = new AbortController().signal;
    host.open('1' as KingdomId, signal);
    host.open(FROM, signal);
    host.follow(raid, signal);
    host.travel!(stage('rise'), signal);
    host.travel!(stage('road'), signal);
    expect(calls).toEqual([]);
    mounted = scene;
    loaded.resolve();
    ready.resolve('map');
    await vi.waitFor(() => expect(calls).toEqual([`open:${FROM}`, 'follow:raid-7', 'travel:rise', 'travel:road']));
    host.travel!(stage('arrived'), signal);
    expect(calls.at(-1)).toBe('travel:arrived');
  });

  it('drops a held open or follow whose signal ended, and close clears what was held', async () => {
    const { calls, scene } = fakeScene();
    const loaded = deferred<void>();
    const ready = deferred<AtlasReadyState>();
    const { host } = gateBridge(() => scene, loaded.promise, ready.promise, () => false);
    const gone = new AbortController();
    host.open(FROM, gone.signal);
    host.follow(raid, gone.signal);
    gone.abort();
    const kept = new AbortController().signal;
    host.travel!(stage('rise'), kept);
    host.close();
    loaded.resolve();
    ready.resolve('map');
    await new Promise(done => setTimeout(done, 0));
    expect(calls).toEqual([]);
  });

  it('keeps listeners through loading, removes them with their signal, and survives a failing one', async () => {
    const { scene } = fakeScene();
    const { host, emit } = gateBridge(() => scene, Promise.resolve(), Promise.resolve('map'), () => false);
    const seen: AtlasGateEvent[] = [];
    const life = new AbortController();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    host.subscribe(() => { throw new Error('listener'); }, new AbortController().signal);
    host.subscribe(event => seen.push(event), life.signal);
    emit({ kind: 'target', channel, land: 'waiting' });
    life.abort();
    emit({ kind: 'closed' });
    expect(seen).toEqual([{ kind: 'target', channel, land: 'waiting' }]);
    errors.mockRestore();
  });

  it('resolves through the drawn map, and to null once disposed', async () => {
    const { scene } = fakeScene();
    let disposed = false;
    const { host } = gateBridge(() => scene, Promise.resolve(), Promise.resolve('map'), () => disposed);
    expect(await host.resolve(TO, new AbortController().signal)).toEqual({ channel, land: 'waiting' });
    expect(await host.resolve(FROM, new AbortController().signal)).toBeNull();
    disposed = true;
    expect(await host.resolve(TO, new AbortController().signal)).toBeNull();
  });
});
