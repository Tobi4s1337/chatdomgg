import { KingdomIdSchema, PersonIdSchema } from '../../shared/src/index';
import { createNativeForgeHost } from '../../forge/src/index';
import { generateSettlementPlan, homeFrame } from '../../world/src/index';
import { createGrowthState, reduceGrowth, projectGrowthScene, GROWTH_POLICY_V1 } from '../../world/src/growth/index';
import { createRealmState, decideRealm } from '../../world/src/realm/reducer';
import { forgeHomeDigest } from '../../../apps/realm/src/wiring/forge';
import { planNativeHomeGrowth } from '../../../apps/realm/src/growth/native';
import { assembleFoundedScene } from '../../../apps/realm/src/founded/scene';
import { createNativeTown } from '../../../apps/realm/src/founded/native';

export async function fixture() {
  const kingdomId = KingdomIdSchema.parse('999000001'), owner = PersonIdSchema.parse('999000002');
  const plan = generateSettlementPlan({ seed:'willowmere', tier:'hamlet', firstYear:2025, year:2026 });
  const plot = plan.homes.find(p => p.tier === 'hut' && p.style === 'hearth')!;
  if (!plot) throw new Error('Missing suitable hut');
  let growth = createGrowthState(kingdomId, 'simulated'), seq = 0;
  growth = reduceGrowth(growth, { type:'home-bound', kingdomId, origin:'simulated', seq:++seq, at:1, personId:owner, plotId:plot.id, installedTier:'hut' }).state;
  for (let day=0; day<GROWTH_POLICY_V1.homeDays.cottage; day++) {
    const at = 1_700_000_000_000 + day*GROWTH_POLICY_V1.streamDayMs, sessionId = `session:${day}`;
    growth = reduceGrowth(growth, { type:'stream-observed', kingdomId, origin:'simulated', seq:++seq, at, startedAt:at, sessionId }).state;
    growth = reduceGrowth(growth, { type:'presence-qualified', kingdomId, origin:'simulated', seq:++seq, at:at+GROWTH_POLICY_V1.qualifiedPresenceMs, personId:owner, sessionId, source:'observed-presence', coveredMs:GROWTH_POLICY_V1.qualifiedPresenceMs, evidenceReceipt:`evidence:${day}` }).state;
  }
  const blueprint = createNativeForgeHost(plot).blueprint;
  const home = { id:plot.id, ownerId:owner, slot:plot.slot, allocationReceipt:'simulated:deed', layoutRevision:plan.revision, revision:'simulated:1', digest:forgeHomeDigest(blueprint), family:plot.style, blueprint, attribution:{makerName:'Juniper',kingdomName:'Willowmere',approvalId:'simulated:names'}, attachments:{} };
  const state = {...createRealmState(kingdomId,'simulated'), sequence:growth.sequence, growth, homes:{[plot.id]:home}};
  const candidate = planNativeHomeGrowth(state,plot.id,plot);
  if (candidate.kind !== 'ready' || candidate.command.fromTier !== 'hut' || candidate.command.tier !== 'cottage') throw new Error(`Unexpected planner result ${JSON.stringify(candidate)}`);
  const native = createNativeTown(plan);
  const before = (await assembleFoundedScene({kingdomId,plan,state,native,collisionRevision:1})).scene;
  const decision = decideRealm(state, candidate.command, {now:growth.asOf+1, capability:'allocation', writerEpoch:'growth:writer', commandId:'growth:capture', current:true, anvilCapacity:2});
  if (decision.kind !== 'accepted') throw new Error(`Realm rejected planned growth: ${decision.reason}`);
  const afterState = decision.state;
  const after = (await assembleFoundedScene({kingdomId,plan,state:afterState,native,collisionRevision:2})).scene;
  const delivery = decision.public.find(message => message.type === 'growth');
  if (!delivery || delivery.type !== 'growth' || !delivery.frame.beats.some(beat => beat.kind === 'home-grown')) throw new Error('Geometry commit did not emit the growth ceremony');
  return { before, after, plot, frame:homeFrame(plot), bootstrap:projectGrowthScene(growth), delivery, publicCommit:decision.public,
    from:candidate.command.fromTier, to:candidate.command.tier, qualifiedDays:growth.citizens[owner]!.qualifiedDays };
}
