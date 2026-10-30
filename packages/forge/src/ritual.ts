import { FORGE_REFUSAL_INTERVAL_MS, type ForgePhase, type ForgePublicBeat, type ForgeRitualFrame } from '@chatdom/shared';
export const FORGE_RITUAL_SECONDS=21;
const stages:readonly [ForgePhase,number,number][]=[['words',0,3],['blueprint',3,5],['pour',5,11],['seal',11,12.2],['strike',12.2,12.7],['cool',12.7,15.5],['flight',15.5,19],['landed',19,21]];
/** Presentation starts only after local assembly/check/mesh succeeds. No progress is fabricated for a pending service. */
export function forgeRitualFrame(ritualId:string,elapsed:number):ForgeRitualFrame {
  const time=Math.max(0,Number.isFinite(elapsed)?elapsed:0),stage=stages.find(([,a,b])=>time>=a&&time<b)??stages[stages.length-1]!;
  return {ritualId,phase:stage[0],elapsed:time,phaseProgress:Math.min(1,(time-stage[1])/(stage[2]-stage[1])),duration:FORGE_RITUAL_SECONDS,source:'simulated'};
}
/** Feed only this projection to public render/audio/director sinks, never the rejected request. */
export function createForgeRefusalGate(){let last=-Infinity;return {beat(nowMs:number):ForgePublicBeat|null{if(!Number.isFinite(nowMs)||nowMs-last<FORGE_REFUSAL_INTERVAL_MS)return null;last=nowMs;return {kind:'refusal',variant:0};}};}
