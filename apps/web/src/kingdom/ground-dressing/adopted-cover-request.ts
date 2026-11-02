import { terrainHeight, type SettlementPlan } from '@chatdom/world';
import { foundedHeightSampler, type SampledGroundWindow } from '../terrain-founded-sampler';
import { lakeKeepOut, planAdoptedCover } from './adopted-cover';
import type { GroundDressingInput, GroundDressingPlan } from './plan';

/**
 * The adopted cover plan for a kingdom whose planting ground is `terrainHeight` (the grand floor, before its land is
 * installed). Planning walks the public ground around every home, so it runs in a worker while the opening builds
 * the rest of the scene. The worker reads the same metre corners the ground workers sampled (`foundedHeightSampler`,
 * equal to `terrainHeight` value for value) and the plan's own lake keep-out, so its plan equals planning here.
 */
export interface AdoptedCoverRequest {
  readonly plan: SettlementPlan;
  readonly ground: SampledGroundWindow | null;
  readonly occupied: GroundDressingInput['occupied'];
  readonly keepClear: GroundDressingInput['keepClear'];
}
export type AdoptedCoverReply = { readonly plan: GroundDressingPlan } | { readonly error: string };

/** The plan exactly as `planAdoptedCover` makes it with `terrainHeight` as the ground. */
export function planAdoptedCoverFor(request: AdoptedCoverRequest): GroundDressingPlan {
  const { plan } = request, sampled = request.ground ? foundedHeightSampler(plan, request.ground) : null;
  return planAdoptedCover(plan, { ground: sampled ?? ((x, z) => terrainHeight(plan, x, z)), waterKeepOut: lakeKeepOut(plan),
    occupied: request.occupied, keepClear: request.keepClear });
}
