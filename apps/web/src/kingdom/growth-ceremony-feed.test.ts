import { beforeAll, describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { KingdomIdSchema, type GrowthSceneFrame } from '@chatdom/shared';
import { createNativeForgeHost } from '@chatdom/forge';
import { assetHashOf } from '@chatdom/world/founded-codec';
import { forgeHomeDigest } from '../../../realm/src/wiring/forge';
import type { RealmWatchCheckpoint } from '@chatdom/shared/realm';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { observeRealm, type RealmObservedRoom } from '../realm/adapters/observer';
import { createGrowthCeremonySession, deferGrowthCeremonies } from './growth-ceremony-feed';

const kingdomId = KingdomIdSchema.parse('999000777');
const plan = generateSettlementPlan({ seed: 'growth-ceremony-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
const plot = plan.homes[0]!;
type SceneKey = 'a' | 'b' | 'c';
const scenes = new Map<SceneKey, RealmFoundedScene>(), wireDigests = new Map<SceneKey, string>();
beforeAll(async () => {
  for (const [key, tier] of [['a', 'hut'], ['b', 'cottage'], ['c', 'house']] as const) {
    const host = createNativeForgeHost({ ...plot, tier, style: 'hearth' });
    const assetHash = await assetHashOf(host.blueprint);
    wireDigests.set(key, forgeHomeDigest(host.blueprint));
    scenes.set(key, { version: 1, kingdomId, origin: 'simulated', layoutRevision: plan.revision, collisionRevision: key === 'a' ? 1 : 2,
      plan, materials: MATERIALS, assets: [{ assetHash, blueprint: host.blueprint }],
      placements: [{ id: 'home-1', plotId: plot.id, assetHash, position: host.position, rotation: plot.rotation }] });
  }
});
const scene = (key: SceneKey) => scenes.get(key)!;
async function prepare(session: ReturnType<typeof createGrowthCeremonySession>) {
  await Promise.all([...scenes.values()].map(value => session.prepare(value)));
}
const frame = (sequence: number): GrowthSceneFrame => ({ version: 1, kingdomId, origin: 'simulated', sequence, asOf: 100,
  homes: [{ plotId: plot.id, stage: 'cottage', qualifiedDays: 7, qualifiedMinutes: 70, currentStreak: 3, bestStreak: 5, nextGoal: null }],
  civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 },
  beats: [{ kind: 'home-grown', plotId: plot.id, from: 'hut', to: 'cottage', qualifiedDays: 7, sourceSeq: sequence, at: 100 }] });
const checkpoint: RealmWatchCheckpoint = { version: 1,
  manifest: { version: 1, kingdomId, origin: 'simulated', sceneHash: 'c'.repeat(64), layoutRevision: plan.revision, collisionRevision: 1 },
  checkpoint: { version: 1, kingdomId, writerEpoch: 'writer', throughCursor: 20, throughSequence: 10, layoutRevision: plan.revision, collisionRevision: 1,
    current: [{ type: 'growth', frame: frame(10) }] } };
function room() {
  const listeners = new Map<string, Set<(value: never) => void>>();
  const room: RealmObservedRoom = { onMessage(type, callback) { const set = listeners.get(type) ?? new Set(); set.add(callback); listeners.set(type, set); return () => { set.delete(callback); }; }, send() {} };
  const emit = (type: string, value: unknown) => { for (const callback of listeners.get(type) ?? []) callback(value as never); };
  const home = (cursor: number, sequence = 11, hash: SceneKey = 'b') => emit('world', { version: 1, kingdomId, writerEpoch: 'writer', sequence, cursor, eventId: `home-${cursor}`, message: { type: 'home', plotId: plot.id, revision: 'r2', assetHash: wireDigests.get(hash)!, attachments: [] } });
  const deliver = (cursor: number, sequence = 11, value: unknown = frame(sequence)) => emit('world', { version: 1, kingdomId, writerEpoch: 'writer', sequence, cursor, eventId: `event-${cursor}`, message: { type: 'growth', frame: value } });
  return { room, emit, deliver, home };
}

describe('witnessed home geometry ceremony handoff', () => {
  it('keeps the eligibility checkpoint quiet, and accepts the actual home-grown even when stage was already cottage', async () => {
    const transport = room(), session = createGrowthCeremonySession();
    await prepare(session);
    session.bind(transport.room, checkpoint, scene('a'));
    transport.emit('bootstrap', checkpoint.checkpoint);
    expect(scene('b').assets[0]!.assetHash).not.toBe(wireDigests.get('b'));
    expect(scene('a').assets[0]!.blueprint).not.toEqual(scene('b').assets[0]!.blueprint);
    expect(session.feed.preview(scene('b'))).toEqual([]);
    transport.home(21); transport.deliver(22);
    expect(session.feed.preview(scene('a'))).toEqual([]); // geometry has not arrived
    expect(session.feed.preview(scene('c'))).toEqual([]); // a later custom revision is not this commit
    expect(session.feed.preview(scene('b'))).toMatchObject([{ beat: { sourceSeq: 11, from: 'hut', to: 'cottage' }, targetHomeDigest: wireDigests.get('b'), previous: { assetHash: scene('a').assets[0]!.assetHash } }]);
  });
  it('survives the old collision observer failing, and hidden replacements cannot consume it', async () => {
    const transport = room(), session = createGrowthCeremonySession();
    await prepare(session);
    const off = session.bind(transport.room, checkpoint, scene('a'));
    const observer = observeRealm(transport.room, { kingdomId, origin: 'simulated', collisionRevision: 1 });
    transport.emit('bootstrap', checkpoint.checkpoint);
    transport.emit('revision', { collisionRevision: 2 });
    transport.home(21); transport.deliver(22);
    expect(observer.current().status).toBe('mismatch');
    const warming = deferGrowthCeremonies(session.feed), key = warming.preview(scene('b'))[0]!.key;
    expect(warming.claim(key)).toBe(false);
    warming.dispose(); off(); observer.dispose();
    const visible = deferGrowthCeremonies(session.feed);
    expect(visible.preview(scene('b'))).toHaveLength(1);
    visible.activate(); expect(visible.claim(key)).toBe(true); expect(visible.claim(key)).toBe(false);
    // A new checkpoint cannot repeat the old beat, nor can redelivery from the old prefix.
    session.bind(transport.room, { ...checkpoint, checkpoint: { ...checkpoint.checkpoint, throughCursor: 21, throughSequence: 11 } }, scene('b'));
    transport.deliver(22);
    expect(visible.preview(scene('c'))).toEqual([]);
  });
  it('drops tail repeats, forged provenance and expired work without inferring an upgrade from entitlement', async () => {
    let now = 0;
    const transport = room(), session = createGrowthCeremonySession(() => now);
    await prepare(session);
    session.bind(transport.room, checkpoint, scene('a'));
    transport.deliver(20); transport.deliver(21, 10);
    transport.deliver(22, 11, { ...frame(11), origin: 'live' });
    transport.deliver(23, 11, { ...frame(11), secret: 'private' });
    expect(session.feed.preview(scene('b'))).toEqual([]);
    transport.home(24); transport.deliver(25); transport.deliver(26);
    expect(session.feed.preview(scene('b'))).toHaveLength(1);
    now = 90_001;
    expect(session.feed.preview(scene('b'))).toEqual([]);
    transport.deliver(27);
    expect(session.feed.preview(scene('b'))).toEqual([]);
  });
  it('retains only exact targets during slow candidate preparation, then claims once or expires on abandonment', async () => {
    let now = 0;
    const transport = room(), session = createGrowthCeremonySession(() => now);
    await prepare(session);
    session.bind(transport.room, checkpoint, scene('a'));
    transport.home(21); transport.deliver(22);
    const warming = deferGrowthCeremonies(session.feed);
    const key = warming.preview(scene('b'))[0]!.key;
    now = 180_000; // Actual candidate mesh preparation can exceed the original 90-second wait.
    expect(warming.preview(scene('b'))).toHaveLength(1);
    expect(warming.claim(key)).toBe(false); // Preparation has not consumed or granted visible activation.
    warming.activate();
    expect(warming.claim(key)).toBe(true);
    expect(warming.claim(key)).toBe(false);
    warming.dispose();

    transport.home(23, 12); transport.deliver(24, 12);
    const abandoned = deferGrowthCeremonies(session.feed);
    expect(abandoned.preview(scene('b'))).toHaveLength(1);
    now += 90_001;
    abandoned.dispose(); // Release, without renewing the original expiry.
    expect(session.feed.preview(scene('b'))).toEqual([]);

    transport.home(25, 13); transport.deliver(26, 13);
    const unrelated = deferGrowthCeremonies(session.feed);
    expect(unrelated.preview(scene('c'))).toEqual([]); // An unmatched candidate cannot retain this work.
    now += 90_001;
    expect(unrelated.preview(scene('b'))).toEqual([]);
    unrelated.dispose();
  });

});
