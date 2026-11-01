import { expect, it } from 'vitest';
import { createNativeForgeHost, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { GrowthSceneFrameSchema, KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmCommitGuard } from '../persistence/postgres-repository';
import type { RealmFact, RealmOwnedAttachment, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState, decideRealm } from '@chatdom/world/realm';
import { forgeHomeDigest } from '../wiring/forge';
import { planNativeHomeGrowth, verifyNativeGrowth } from './native';

function fixture() {
  const kingdomId = KingdomIdSchema.parse('900010001'), ownerId = PersonIdSchema.parse('900010002');
  const layout = generateSettlementPlan({ seed: 'SIMULATED-native-growth', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const plot = { ...layout.homes[0]!, tier: 'hut' as const, style: 'hearth' as const, variant: 0 };
  const blueprint = createNativeForgeHost(plot).blueprint;
  const home: RealmOwnedHome = { id: plot.id, ownerId, slot: plot.slot, allocationReceipt: `deed:${'a'.repeat(64)}`,
    layoutRevision: layout.revision, revision: 'native:original', digest: forgeHomeDigest(blueprint), family: plot.style,
    blueprint, attachments: {}, attribution: { makerName: 'SIMULATED Juniper', kingdomName: 'SIMULATED test', approvalId: 'names:approved' } };
  const initial = createRealmState(kingdomId, 'simulated');
  const state: RealmPrivateState = { ...initial, homes: { [home.id]: home }, growth: { ...initial.growth!, citizens: { [ownerId]: {
    qualifiedDays: 7, lastQualifiedOrdinal: 7, streak: 7, bestStreak: 7, home: { plotId: home.id, stage: 'cottage' },
  } } } };
  const deed = { receipt: home.allocationReceipt, person_id: ownerId, kingdom_id: kingdomId, origin: 'simulated',
    layout_revision: home.layoutRevision, plot_id: home.id, slot: home.slot, status: 'installed', placement: JSON.stringify(plot) };
  const tx = { query: async () => ({ rows: [deed] }) } as unknown as Parameters<RealmCommitGuard>[0];
  const context = { now: 1, capability: 'allocation' as const, writerEpoch: 'growth:writer', commandId: 'growth:test', current: true, anvilCapacity: 2 };
  return { state, home, plot, tx, context };
}

it('grows the exact native hut into the earned cottage and revalidates the deed and target inside the commit', async () => {
  const { state, home, plot, tx, context } = fixture();
  const planned = planNativeHomeGrowth(state, home.id, plot);
  expect(planned.kind).toBe('ready');
  if (planned.kind !== 'ready') throw new Error(planned.reason);
  expect(planned.command.home.blueprint).toEqual(createNativeForgeHost({ ...plot, tier: 'cottage' }).blueprint);
  const decision = decideRealm(state, planned.command, context);
  expect(decision.kind).toBe('accepted');
  if (decision.kind !== 'accepted') throw new Error(decision.reason);
  expect(await verifyNativeGrowth(tx, decision.fact, state)).toBe('ok');
  expect(decision.state.homes[home.id]).toEqual(planned.command.home);
  expect(decision.state.growth?.citizens[home.ownerId]?.qualifiedDays).toBe(7);
  expect(decision.public[0]).toMatchObject({ type: 'home', plotId: home.id, assetHash: planned.command.home.digest });
  const grown = decision.public.find(message => message.type === 'growth');
  expect(grown?.frame.beats).toEqual([{ kind: 'home-grown', sourceSeq: decision.fact.seq, at: decision.fact.committedAt,
    plotId: home.id, from: 'hut', to: 'cottage', qualifiedDays: 7 }]);
  expect(GrowthSceneFrameSchema.safeParse(grown?.frame).success).toBe(true);
  const unearned = { ...state, growth: { ...state.growth!, citizens: { [home.ownerId]: { ...state.growth!.citizens[home.ownerId]!, home: { plotId: home.id, stage: 'hut' as const } } } } };
  expect(decideRealm(unearned, planned.command, context)).toEqual({ kind: 'rejected', reason: 'forbidden' });
  expect(await verifyNativeGrowth(tx, decision.fact, unearned)).toBe('conflict');
  expect(await verifyNativeGrowth(tx, { ...decision.fact, body: { ...planned.command, home: { ...planned.command.home, family: 'tide' } } }, state)).toBe('conflict');
});

it('leaves a custom-built home intact even when its name and native-looking revision are unchanged', async () => {
  const { state, home, plot, tx, context } = fixture();
  const planned = planNativeHomeGrowth(state, home.id, plot);
  if (planned.kind !== 'ready') throw new Error(planned.reason);
  const blueprint = { ...home.blueprint, boxes: [...home.blueprint.boxes, { from: [0, 0, 0] as [number, number, number], to: [1, 1, 1] as [number, number, number], material: 1 }] };
  const custom = { ...home, blueprint, digest: forgeHomeDigest(blueprint) };
  const edited = { ...state, homes: { [home.id]: custom } };
  expect(planNativeHomeGrowth(edited, home.id, plot)).toEqual({ kind: 'held', reason: 'custom-home' });
  const decision = decideRealm(state, planned.command, context);
  if (decision.kind !== 'accepted') throw new Error(decision.reason);
  expect(await verifyNativeGrowth(tx, decision.fact, edited)).toBe('conflict');
  expect(edited.homes[home.id]).toBe(custom);
});

it('refits an existing forged part with its identity, words, plan and provenance preserved', async () => {
  const { state, home, plot, tx, context } = fixture();
  const socket = findForgeSockets(home.blueprint).find(value => value.kind === 'chimney')!;
  const kit = forgeStyleKit(home.family);
  const part: RealmOwnedAttachment = { forgeKey: 'SIMULATED-forge', ownerId: home.ownerId, homeId: home.id, attached: true,
    creation: { words: 'SIMULATED sleeping dragon chimney' }, approvalReceipt: 'judges:original', attachment: {
      version: 1, id: 'SIMULATED-attachment', runId: 'SIMULATED-run', kingdomId: state.kingdomId, slot: home.slot,
      hostId: home.blueprint.id, hostFingerprint: homeFingerprint(home.blueprint), socketId: socket.id, origin: socket.origin,
      kitId: kit.id, kitRevision: kit.revision, family: home.family, committedAt: 0,
      draft: { title: 'SIMULATED dragon chimney', plaque: 'SIMULATED original creation', plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' } },
      provenance: { source: 'simulated', makerName: home.attribution.makerName, kingdomName: home.attribution.kingdomName, designId: 'SIMULATED-design', firstForgedAt: 0 },
    } };
  const attached: RealmPrivateState = { ...state, homes: { [home.id]: { ...home, attachments: { [socket.id]: part.attachment.id } } }, attachments: { [part.attachment.id]: part } };
  const planned = planNativeHomeGrowth(attached, home.id, plot);
  expect(planned.kind).toBe('ready');
  if (planned.kind !== 'ready') throw new Error(planned.reason);
  const decision = decideRealm(attached, planned.command, context);
  expect(decision.kind).toBe('accepted');
  if (decision.kind !== 'accepted') throw new Error(decision.reason);
  expect(await verifyNativeGrowth(tx, decision.fact as RealmFact, attached)).toBe('ok');
  const moved = decision.state.attachments[part.attachment.id]!;
  expect(moved).toEqual({ ...part, attachment: { ...part.attachment, ...planned.command.attachments[0]!.placement } });
  expect(moved.attachment.hostFingerprint).not.toBe(part.attachment.hostFingerprint);
  expect(decision.public[0]).toMatchObject({ type: 'home', attachments: [moved.attachment] });
  expect(decideRealm(attached, { ...planned.command, attachments: [], home: { ...planned.command.home, attachments: {} } }, context)).toMatchObject({ kind: 'rejected', reason: 'conflict' });
});
