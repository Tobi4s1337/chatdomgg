import { describe, expect, it } from 'vitest';
import { assembleForge, createNativeForgeHost, findForgeSockets, forgeStyleKit, homeFingerprint, CURRENT_FORGE_STYLE_KIT_REVISION } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type HousePartPlan } from '@chatdom/shared';
import type { CommittedForgeAttachment, RealmOwnedAttachment, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState, decideRealm } from '@chatdom/world/realm';
import { assetHashOf } from '../founded/codec';
import { createNativeTown } from '../founded/native';
import { assembleFoundedScene } from '../founded/scene';
import { forgeHomeDigest } from '../wiring/forge';
import { planNativeHomeGrowth } from './native';

/** One home carrying a piece forged on kit revision one and another forged on revision two (SEAMS.md §9 of forge-wish). */
const kingdomId = KingdomIdSchema.parse('900030001'), ownerId = PersonIdSchema.parse('900030002');
const layout = generateSettlementPlan({ seed: 'SIMULATED-kit-revisions', tier: 'hamlet', firstYear: 2026, year: 2026 });
const plot = { ...layout.homes[0]!, tier: 'hut' as const, style: 'hearth' as const, variant: 0 };
const blueprint = createNativeForgeHost(plot).blueprint;
const attribution = { makerName: 'SIMULATED Juniper', kingdomName: 'SIMULATED test', approvalId: 'names:approved' };

function part(id: string, revision: 1 | 2, plan: Extract<HousePartPlan, { version: 2 }>): RealmOwnedAttachment {
  const kit = forgeStyleKit(plot.style, revision), socket = findForgeSockets(blueprint, 'street-home', revision).find(s => s.kind === plan.kind)!;
  const attachment: CommittedForgeAttachment = { version: 1, id, runId: id, kingdomId, slot: plot.slot, hostId: blueprint.id,
    hostFingerprint: homeFingerprint(blueprint), socketId: socket.id, origin: [...socket.origin], kitId: kit.id, kitRevision: kit.revision,
    family: plot.style, committedAt: 0, draft: { title: `SIMULATED ${id}`, plaque: 'SIMULATED creation', plan },
    provenance: { source: 'simulated', makerName: attribution.makerName, kingdomName: attribution.kingdomName, designId: `design-${id}`, firstForgedAt: 0 } };
  return { forgeKey: `wish:${id}`, ownerId, homeId: plot.id, attached: true, creation: { words: 'SIMULATED words' }, approvalReceipt: `judges:${id}`, attachment };
}

function mixed() {
  const old = part('rev-one-dragon', 1, { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' });
  const fresh = part('rev-two-moon', 2, { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' });
  const home: RealmOwnedHome = { id: plot.id, ownerId, slot: plot.slot, allocationReceipt: `deed:${'a'.repeat(64)}`, layoutRevision: layout.revision,
    revision: 'native:original', digest: forgeHomeDigest(blueprint), family: plot.style, blueprint, attribution,
    attachments: { [old.attachment.socketId]: old.attachment.id, [fresh.attachment.socketId]: fresh.attachment.id } };
  const initial = createRealmState(kingdomId, 'simulated');
  const state: RealmPrivateState = { ...initial, homes: { [home.id]: home }, attachments: { [old.attachment.id]: old, [fresh.attachment.id]: fresh },
    growth: { ...initial.growth!, citizens: { [ownerId]: { qualifiedDays: 7, lastQualifiedOrdinal: 7, streak: 7, bestStreak: 7, home: { plotId: home.id, stage: 'cottage' } } } } };
  return { state, home, old, fresh };
}

describe('mixed Forge kit revisions', () => {
  it('new work uses revision two', () => {
    expect(CURRENT_FORGE_STYLE_KIT_REVISION).toBe(2);
    expect(forgeStyleKit('hearth').revision).toBe(2);
  });

  it('the founded scene rebuilds each piece with the kit it was forged with', async () => {
    const { state, old, fresh } = mixed();
    const build = await assembleFoundedScene({ kingdomId, plan: { ...layout, homes: [plot, ...layout.homes.slice(1)] }, state,
      native: createNativeTown({ ...layout, homes: [plot, ...layout.homes.slice(1)] }), collisionRevision: 3 });
    for (const item of [old, fresh]) {
      const revision = item.attachment.kitRevision;
      const socket = findForgeSockets(blueprint, 'street-home', revision).find(s => s.id === item.attachment.socketId)!;
      const expected = assembleForge(item.attachment.draft.plan, forgeStyleKit(plot.style, revision), socket).blueprint;
      const placed = build.scene.placements.find(p => p.id === `forge:${item.attachment.id}`);
      expect(placed, item.attachment.id).toBeDefined();
      expect(placed!.assetHash).toBe(await assetHashOf(expected));
    }
    expect(build.counts).toMatchObject({ attachments: 2 });
  }, 30_000);

  it('native growth refits both pieces, each on its own revision, without relabelling them', () => {
    const { state, old, fresh } = mixed();
    const planned = planNativeHomeGrowth(state, plot.id, plot);
    expect(planned.kind).toBe('ready');
    if (planned.kind !== 'ready') throw new Error(planned.reason);
    const decision = decideRealm(state, planned.command, { now: 1, capability: 'allocation', writerEpoch: 'growth:writer', commandId: 'growth:kit-revisions', current: true, anvilCapacity: 2 });
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') throw new Error(decision.reason);
    for (const item of [old, fresh]) {
      const moved = decision.state.attachments[item.attachment.id]!.attachment;
      expect([moved.kitId, moved.kitRevision, moved.draft]).toEqual([item.attachment.kitId, item.attachment.kitRevision, item.attachment.draft]);
      const target = planned.command.home.blueprint;
      const socket = findForgeSockets(target, 'street-home', moved.kitRevision).find(s => s.id === moved.socketId)!;
      expect(socket.origin).toEqual(moved.origin);
    }
  }, 30_000);

  it('an unknown revision holds growth and fails the scene closed', async () => {
    const { state, fresh } = mixed();
    const broken: RealmPrivateState = { ...state, attachments: { ...state.attachments,
      [fresh.attachment.id]: { ...fresh, attachment: { ...fresh.attachment, kitRevision: 9 } } } };
    expect(planNativeHomeGrowth(broken, plot.id, plot)).toEqual({ kind: 'held', reason: 'unsafe-part' });
    await expect(assembleFoundedScene({ kingdomId, plan: { ...layout, homes: [plot, ...layout.homes.slice(1)] }, state: broken,
      native: createNativeTown({ ...layout, homes: [plot, ...layout.homes.slice(1)] }), collisionRevision: 3 })).rejects.toThrow(/unregistered kit/);
  }, 30_000);
});
