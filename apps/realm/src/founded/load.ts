import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import type { RealmPrivateState } from '@chatdom/shared/realm';
import type { SettlementPlan } from '@chatdom/world';
import type { AllocationService } from '../allocation';
import { canonicalSceneJson } from './codec';
import { FoundedContentError, createNativeTown, supportedLandform, type NativeTown } from './native';

/** The only reads the founded producer needs from allocation: the adopted head and its exact stored plan. */
export type FoundedLayoutSource = Pick<AllocationService, 'origin' | 'currentLayout' | 'layoutPlan'>;

export class FoundedUnavailableError extends Error {
  readonly code = 'realm.founded-unavailable';
  constructor(readonly reason: 'unfounded' | 'origin' | 'kingdom' | 'revision' | 'unsupported', detail: string) {
    super(detail); this.name = 'FoundedUnavailableError';
  }
}

export interface AdoptedPlan {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly revision: string;
  readonly foundedAt: number;
  readonly adoptedAt: number;
  readonly plan: SettlementPlan;
}

/**
 * Resolve the kingdom's current adopted revision and load that exact stored plan (spec 38 R1). No founded record is
 * unavailable: entry never founds a kingdom, and nothing is generated here. The loaded authority state must be the
 * same kingdom and origin as the allocation service, and the stored plan must carry the head's revision.
 */
export async function loadAdoptedPlan(source: FoundedLayoutSource, kingdomId: KingdomId, state: RealmPrivateState): Promise<AdoptedPlan> {
  KingdomIdSchema.parse(kingdomId);
  if (state.kingdomId !== kingdomId) throw new FoundedUnavailableError('kingdom', `the loaded state belongs to kingdom ${state.kingdomId}, not ${kingdomId}`);
  if (state.origin !== source.origin) throw new FoundedUnavailableError('origin', `a ${state.origin} kingdom cannot open on ${source.origin} layouts`);
  const head = await source.currentLayout(kingdomId);
  if (!head) throw new FoundedUnavailableError('unfounded', `kingdom ${kingdomId} has no adopted ${source.origin} layout`);
  const plan = await source.layoutPlan(kingdomId, head.revision);
  if (plan.revision !== head.revision) throw new FoundedUnavailableError('revision', `stored layout ${head.revision} carries revision ${plan.revision}`);
  try { supportedLandform(plan); }
  catch (error) { throw new FoundedUnavailableError('unsupported', error instanceof FoundedContentError ? error.message : 'unsupported layout'); }
  return { kingdomId, origin: source.origin, revision: head.revision, foundedAt: head.foundedAt, adoptedAt: head.adoptedAt, plan };
}

/**
 * Bounded reuse of native content across openings. Keyed by kingdom and revision, and checked against the plan's
 * exact canonical text, so a different plan under the same name is rebuilt rather than served stale geometry.
 */
export class NativeTownCache {
  private readonly entries = new Map<string, { readonly text: string; readonly town: NativeTown }>();
  constructor(private readonly limit = 16) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new RangeError('NativeTownCache needs a limit of 1..1024');
  }

  get(kingdomId: KingdomId, plan: SettlementPlan): NativeTown {
    const key = `${kingdomId}\n${plan.revision}`, text = canonicalSceneJson(plan), hit = this.entries.get(key);
    if (hit && hit.text === text) { this.entries.delete(key); this.entries.set(key, hit); return hit.town; }
    const town = createNativeTown(plan);
    this.entries.delete(key); this.entries.set(key, { text, town });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return town;
  }

  get size(): number { return this.entries.size; }
}
