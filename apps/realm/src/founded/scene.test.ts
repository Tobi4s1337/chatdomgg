import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { findForgeSockets, forgeStyleKit, homeFingerprint, createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import type { CommittedForgeAttachment, RealmFoundedManifest, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import { generateSettlementPlan, homeOrigin, transformCardinalPoint, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { assetHashOf, canonicalSceneJson, utf8 } from './codec';
import { FoundedUnavailableError, NativeTownCache, loadAdoptedPlan, type FoundedLayoutSource } from './load';
import { createNativeTown } from './native';
import { assembleFoundedScene } from './scene';
import { FoundedSceneError, decodeFoundedScene, encodeFoundedScene, validateFoundedScene } from './validate';

const kingdomId = KingdomIdSchema.parse('900000002'), owner = PersonIdSchema.parse('900000202');
const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
const native = createNativeTown(plan);
const empty = createRealmState(kingdomId, 'simulated');
const PRIVATE = ['900000202', 'deed:private-receipt', 'Juniper', 'Emberwick', 'names:approval', 'PRIVATE WISH', 'judges:private', 'opaque-safety'];

/** A committed owner of `plot`: an approved rebuild of another reviewed form and two forged parts on one socket. */
function ownedState(): { state: RealmPrivateState; rebuilt: VoxelBlueprint; socket: ReturnType<typeof findForgeSockets>[number]; plot: SettlementPlan['homes'][number] } {
  const plot = plan.homes.find(home => home.style !== 'grove')!;
  const rebuilt = createNativeForgeHost({ ...plot, variant: (plot.variant + 1) % 3 }).blueprint;
  const socket = findForgeSockets(rebuilt)[0]!, kit = forgeStyleKit(plot.style);
  const part = (id: string, motif: 'crescent-moon' | 'shooting-star'): CommittedForgeAttachment => ({ version: 1, id, runId: id, kingdomId, slot: plot.slot,
    hostId: rebuilt.id, hostFingerprint: homeFingerprint(rebuilt), socketId: socket.id, origin: [...socket.origin], kitId: kit.id, kitRevision: kit.revision,
    family: plot.style, draft: { plan: { version: 2, kind: socket.kind, motif, finish: 'native', accent: 'none' }, title: 'A piece', plaque: 'Made here' },
    committedAt: 5, provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'Emberwick', designId: `design-${id}`, firstForgedAt: 5 } });
  const attribution = { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:approval' };
  const home: RealmOwnedHome = { id: plot.id, ownerId: owner, slot: plot.slot, allocationReceipt: 'deed:private-receipt', layoutRevision: plan.revision,
    revision: 'r9', digest: 'a'.repeat(64), family: plot.style, blueprint: rebuilt, attribution, attachments: { [socket.id]: 'run-b' } };
  const item = (id: string, attached: boolean) => ({ forgeKey: `wish:${id}`, ownerId: owner, homeId: plot.id, attached, attachment: part(id, attached ? 'shooting-star' : 'crescent-moon'),
    creation: { words: 'PRIVATE WISH' }, approvalReceipt: 'judges:private' });
  const state: RealmPrivateState = { ...empty, sequence: 9, homes: { [plot.id]: home }, attachments: { 'run-a': item('run-a', false), 'run-b': item('run-b', true) },
    rights: { [owner]: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-safety' } } };
  return { state, rebuilt, socket, plot };
}

const assemble = (state: RealmPrivateState, extra: { collisionRevision?: number } = {}) =>
  assembleFoundedScene({ kingdomId, plan, state, native, collisionRevision: extra.collisionRevision ?? 7 });

let valid: Promise<string> | undefined;
async function rejects(mutate: (scene: Record<string, any>) => void, label: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  valid ??= assemble(empty).then(build => canonicalSceneJson(build.scene));
  const copy = JSON.parse(await valid);
  mutate(copy);
  await expect(validateFoundedScene(copy), label).rejects.toBeInstanceOf(FoundedSceneError);
}

describe('founded scene (spec 38 R1-R3)', () => {
  it('installs the exact plan as native homes, garden edges, market, castle and groves with stable bytes', async () => {
    const first = await assemble(empty), again = await assembleFoundedScene({ kingdomId, plan, state: empty, collisionRevision: 7 });
    expect(again.manifest).toEqual(first.manifest);
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    const { scene } = first, byId = new Map(scene.placements.map(p => [p.id, p]));
    expect(canonicalSceneJson(scene.plan)).toBe(canonicalSceneJson(plan));
    for (const home of plan.homes) {
      const placed = byId.get(`home:${home.id}`)!, host = createNativeForgeHost(home);
      expect(placed).toMatchObject({ plotId: home.id, rotation: home.rotation, position: [...host.position] });
      expect(placed.assetHash).toBe(await assetHashOf(host.blueprint));
    }
    for (const module of plan.castle.modules) expect(byId.get(`castle:${module.id}`)).toMatchObject({ position: [...module.position], rotation: module.rotation });
    expect(scene.placements.filter(p => p.id.startsWith('tree:')).length).toBeGreaterThan(40);
    expect(['market:well', 'market:stall:0', 'market:stall:1'].every(id => byId.has(id))).toBe(true);
    // One asset per distinct byte content; repeated plots share it.
    expect(new Set(scene.assets.map(a => a.assetHash)).size).toBe(scene.assets.length);
    expect(scene.assets.length).toBeLessThan(scene.placements.length / 3);
    expect(first.homes.every(h => h.source === 'native')).toBe(true);
    // The geometry identity ignores only the revision number it is mapped to.
    expect((await assemble(empty, { collisionRevision: 8 })).geometryDigest).toBe(first.geometryDigest);
  });

  it('replaces a committed home at its own plot frame and keeps only the currently attached part', async () => {
    const { state, rebuilt, socket, plot } = ownedState();
    const build = await assemble(state), { scene } = build, text = new TextDecoder().decode(build.bytes);
    const homes = scene.placements.filter(p => p.plotId === plot.id);
    const origin = homeOrigin(plot, rebuilt.size[2] * VOXEL_METRES.build);
    expect(homes.map(p => p.id)).toEqual([`home:${plot.id}`, 'forge:run-b']);
    expect(homes[0]).toMatchObject({ assetHash: await assetHashOf(rebuilt), position: [...origin], rotation: plot.rotation });
    expect(homes[0]!.assetHash).not.toBe(await assetHashOf(createNativeForgeHost(plot).blueprint));
    expect(homes[1]!.position).toEqual(transformCardinalPoint(origin, plot.rotation, socket.origin.map(n => n * VOXEL_METRES.build) as [number, number, number]));
    expect(build.homes.find(h => h.plotId === plot.id)).toEqual({ plotId: plot.id, source: 'owned', revision: 'r9', digest: 'a'.repeat(64), attachments: ['run-b'] });
    expect(build.counts).toMatchObject({ ownedHomes: 1, attachments: 1 });
    for (const secret of PRIVATE) expect(text, secret).not.toContain(secret);
    expect(text).not.toContain('run-a');
    expect(build.geometryDigest).not.toBe((await assemble(empty)).geometryDigest);
  });

  it('keeps distinct bytes distinct when an approved edit shares a semantic blueprint ID', async () => {
    const twin = plan.homes.find((home, i) => plan.homes.some((other, j) => j !== i && other.style === home.style && other.tier === home.tier && other.variant === home.variant))!;
    const base = createNativeForgeHost(twin).blueprint;
    const edited: VoxelBlueprint = { ...base, boxes: [...base.boxes, { from: [2, 0, 2], to: [4, 2, 4], material: base.boxes[0]!.material }] };
    const home: RealmOwnedHome = { id: twin.id, ownerId: owner, slot: twin.slot, allocationReceipt: 'deed:x', layoutRevision: plan.revision, revision: 'b1', digest: 'b'.repeat(64),
      family: twin.style, blueprint: edited, attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:approval' }, attachments: {} };
    const { scene } = await assemble({ ...empty, homes: { [twin.id]: home } });
    const same = scene.assets.filter(a => a.blueprint.id === base.id);
    expect(same.length).toBe(2);
    expect(new Set(same.map(a => a.assetHash)).size).toBe(2);
  });

  it('fails closed on inconsistent committed state', async () => {
    const { state, plot } = ownedState(), home = state.homes[plot.id]!;
    const bad = (next: RealmPrivateState) => expect(assemble(next)).rejects.toBeInstanceOf(FoundedSceneError);
    await bad({ ...state, homes: { [plot.id]: { ...home, attachments: { [Object.keys(home.attachments)[0]!]: 'run-a' } } } });
    await bad({ ...state, homes: { [plot.id]: { ...home, attachments: {} } } });
    await bad({ ...state, homes: { [plot.id]: { ...home, slot: home.slot + 1 } } });
    await bad({ ...state, homes: { 'plot:elsewhere': { ...home, id: 'plot:elsewhere', attachments: {} } }, attachments: {} });
    await bad({ ...state, attachments: { ...state.attachments, 'run-b': { ...state.attachments['run-b']!, attachment: { ...state.attachments['run-b']!.attachment, origin: [0, 0, 0] } } } });
    await bad({ ...state, attachments: { ...state.attachments, 'run-b': { ...state.attachments['run-b']!, attachment: { ...state.attachments['run-b']!.attachment, kitRevision: 2 } } } });
    await bad({ ...state, kingdomId: KingdomIdSchema.parse('900000003') });
    await expect(assemble(empty, { collisionRevision: 2 ** 32 })).rejects.toBeInstanceOf(FoundedSceneError);
    await expect(assembleFoundedScene({ kingdomId, plan: { ...plan, revision: 'settlement:other' }, state: empty, native, collisionRevision: 1 })).rejects.toBeInstanceOf(FoundedSceneError);
  });

  it('validates the whole allowlist and refuses unknown, borrowed or unbounded geometry', async () => {
    await rejects(s => { s['owners'] = []; }, 'an extra scene field');
    await rejects(s => { s['placements'][0].ownerId = 'x'; }, 'a private placement field');
    await rejects(s => { s['assets'][0].blueprint.boxes.push({ from: [0, 0, 0], to: [1, 1, 1], material: 999 }); }, 'an unknown material');
    await rejects(s => { s['assets'][0].blueprint.boxes.push({ from: [0, 0, 0], to: [1, 1, 1], material: 1 }); }, 'a borrowed hash');
    await rejects(s => { s['placements'][1].id = s['placements'][0].id; }, 'a repeated placement');
    await rejects(s => { s['placements'][0].rotation = 4; }, 'a non-cardinal turn');
    await rejects(s => { s['placements'][0].position[0] = 1e9; }, 'an unbounded position');
    await rejects(s => { s['placements'][0].assetHash = 'f'.repeat(64); }, 'a missing asset');
    await rejects(s => { s['placements'] = s['placements'].filter((p: { id: string }) => !p.id.startsWith('home:')); }, 'a street without homes');
    await rejects(s => { s['placements'] = s['placements'].filter((p: { id: string }) => !p.id.startsWith('tree:')); }, 'an unreferenced asset');
    await rejects(s => { s['layoutRevision'] = 'settlement:other'; }, 'plan/revision disagreement');
    await rejects(s => { s['plan'].landform.version = 2; }, 'an unsupported landform');
    await rejects(s => { s['plan'].owners = []; }, 'an extra plan field');
    await rejects(s => { s['collisionRevision'] = 2 ** 32; }, 'a revision beyond uint32');
    await rejects(s => { s['origin'] = 'staging'; }, 'an unknown origin');
  });

  it('decodes only the exact bytes its receipt names', async () => {
    const { bytes, manifest } = await assemble(empty);
    await expect(decodeFoundedScene(bytes, manifest)).resolves.toMatchObject({ kingdomId, collisionRevision: 7 });
    const tampered = bytes.slice(); tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 1;
    await expect(decodeFoundedScene(tampered, manifest)).rejects.toThrow('hash');
    // An old receipt cannot acquire other bytes, and a matching hash with other revisions is refused.
    const other = await assemble(empty, { collisionRevision: 8 });
    await expect(decodeFoundedScene(other.bytes, manifest)).rejects.toThrow('hash');
    const relabelled = await encodeFoundedScene({ ...(await decodeFoundedScene(bytes, manifest)) });
    await expect(decodeFoundedScene(relabelled.bytes, { ...relabelled.manifest, collisionRevision: 9 })).rejects.toThrow('receipt');
  });
});

describe('the adopted plan is the address book (R1)', () => {
  const source = (head: { revision: string } | null, stored: SettlementPlan = plan, origin: 'live' | 'simulated' = 'simulated'): FoundedLayoutSource => ({
    origin,
    currentLayout: async () => head && { revision: head.revision, foundedAt: 1, adoptedAt: 2 },
    layoutPlan: async (_kingdom, revision) => { if (revision !== head?.revision) throw new Error('unknown revision'); return stored; },
  });
  const reason = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error instanceof FoundedUnavailableError ? error.reason : 'other'; } return 'ok'; };

  it('loads exactly the stored current revision and refuses everything else', async () => {
    const adopted = await loadAdoptedPlan(source({ revision: plan.revision }), kingdomId, empty);
    expect(adopted.plan).toBe(plan);
    expect(adopted).toMatchObject({ kingdomId, origin: 'simulated', revision: plan.revision, foundedAt: 1, adoptedAt: 2 });
    expect(await reason(loadAdoptedPlan(source(null), kingdomId, empty))).toBe('unfounded');
    expect(await reason(loadAdoptedPlan(source({ revision: plan.revision }, plan, 'live'), kingdomId, empty))).toBe('origin');
    expect(await reason(loadAdoptedPlan(source({ revision: plan.revision }), KingdomIdSchema.parse('900000003'), empty))).toBe('kingdom');
    expect(await reason(loadAdoptedPlan(source({ revision: 'settlement:newer' }), kingdomId, empty))).toBe('revision');
    const future = { ...plan, landform: { ...plan.landform, version: 2 } } as unknown as SettlementPlan;
    expect(await reason(loadAdoptedPlan(source({ revision: plan.revision }, future), kingdomId, empty))).toBe('unsupported');
  });

  it('reuses native content only for the identical plan', () => {
    const cache = new NativeTownCache(2), town = cache.get(kingdomId, plan);
    expect(cache.get(kingdomId, plan)).toBe(town);
    const moved = { ...plan, market: { ...plan.market, elevation: plan.market.elevation + 1 } };
    expect(cache.get(kingdomId, moved)).not.toBe(town);
    expect(cache.size).toBe(1);
  });
});

describe('the SIMULATED current-town artifact', () => {
  const at = (name: string) => new URL(`./artifacts/simulated-town.${name}`, import.meta.url);

  it('decodes as a browser would and preserves the adopted plan, owned home and attached part', async () => {
    const bytes = new Uint8Array(await readFile(at('scene.json')));
    const manifest = JSON.parse(await readFile(at('manifest.json'), 'utf8')) as RealmFoundedManifest;
    const scene: RealmFoundedScene = await decodeFoundedScene(bytes, manifest);
    expect(scene).toMatchObject({ origin: 'simulated', kingdomId: '900000001', collisionRevision: 1, layoutRevision: 'settlement:2:23b3c1b5' });
    // The adopted plan was stored and loaded, not regenerated; its fixture generator is the only reproduction path.
    expect(canonicalSceneJson(scene.plan)).toBe(canonicalSceneJson(generateSettlementPlan({ seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 })));
    expect(scene.placements.length).toBe(924);
    expect(scene.placements.filter(p => p.plotId === 'plot:2023:8').map(p => p.id)).toEqual(['home:plot:2023:8', 'forge:simulated-run-2']);
    expect(scene.placements.some(p => p.id === 'forge:simulated-run-1')).toBe(false);
    // Exact deterministic bytes: re-encoding the decoded scene reproduces the receipt.
    expect((await encodeFoundedScene(scene)).manifest).toEqual(manifest);
    expect(utf8(canonicalSceneJson(scene)).byteLength).toBe(bytes.byteLength);
  });
});
