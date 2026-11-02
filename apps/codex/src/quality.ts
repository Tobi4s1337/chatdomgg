import type { ForgeDraft, ForgeHouseSocket, ForgeStyleKit } from '@chatdom/shared';
import { forgeMotifCertificate, forgeReadableFinishes, type ForgeCertificateFamily } from './certificates';
import type { JudgeVerdict } from './providers';
import { agreedForgeWishSubject, forgeMeasureDetailMatch, forgeMeasureSlotMissed, scoreForgeMeasure,
  type ForgeQualityMeasure, type ForgeSubjectReading } from './providers/policy';

const unclear: ForgeSubjectReading = { motif: 'unclear', slot: 'unclear' };
const motifWords: Record<ForgeDraft['plan']['motif'], string> = {
  'sleeping-dragon': 'a dragon', 'crescent-moon': 'a moon', 'watchful-owl': 'an owl', 'sleeping-fox': 'a fox',
  sunflower: 'a sunflower', 'scallop-shell': 'a seashell', 'shooting-star': 'a star',
};

/** The finite facts behind a result's quality score. Recomputed identically on recovery and by the realm. */
export function forgeResultMeasure(input: { words?: ForgeSubjectReading | undefined; result?: ForgeSubjectReading | undefined; draft: ForgeDraft;
  styleKit: Pick<ForgeStyleKit, 'family' | 'revision'>; sockets: readonly Pick<ForgeHouseSocket, 'kind'>[] }): ForgeQualityMeasure {
  const words = input.words ?? unclear, result = input.result ?? unclear, plan = input.draft.plan;
  const slot = words.slot !== 'unclear' && words.slot === result.slot ? words.slot : 'none';
  return { words: { ...words }, result: { ...result }, plan: { motif: plan.motif, kind: plan.kind },
    certificate: forgeMotifCertificate(input.styleKit.family, input.styleKit.revision, plan.motif, plan.version === 2 ? plan.finish : 'native'),
    slotAvailable: slot === 'none' || input.sockets.some(socket => socket.kind === slot) };
}
/** Attach the deterministic score to a safety verdict. The model's own reading stays in its records. */
export function withForgeQuality(verdict: JudgeVerdict, measure: ForgeQualityMeasure): JudgeVerdict {
  return { ...verdict, measure, quality: scoreForgeMeasure(measure), detailMatch: forgeMeasureDetailMatch(measure) };
}
/**
 * Before any result read: the word gate named a kit motif or an available slot, and the draft chose otherwise.
 * One quiet redraft is cheaper than judging a piece that cannot be exact. It never decides an outcome, and it is only
 * asked for when the plan the words name would actually assemble on this home: a fitting draft is never traded for
 * one that cannot land.
 */
export function forgeEarlyRedraft(words: ForgeSubjectReading | undefined, draft: ForgeDraft,
  sockets: readonly Pick<ForgeHouseSocket, 'kind'>[], fits: (plan: ForgeDraft['plan']) => boolean): boolean {
  if (!words) return false;
  const plan = draft.plan;
  const motif = words.motif !== 'none' && words.motif !== 'unclear' ? words.motif : plan.motif;
  const kind = words.slot !== 'none' && words.slot !== 'unclear' && sockets.some(socket => socket.kind === words.slot) ? words.slot : plan.kind;
  if (motif === plan.motif && kind === plan.kind) return false;
  if (fits({ ...plan, motif, kind })) return true;
  return motif !== plan.motif && kind !== plan.kind && fits({ ...plan, motif });
}
/** A retry is offered only when another draft could actually do better. An unsupported subject's closest piece is final. */
export function forgeQualityRetryUseful(verdict: JudgeVerdict, family: ForgeCertificateFamily, revision: number,
  fits: (plan: Pick<ForgeDraft['plan'], 'motif' | 'kind'>) => boolean = () => true): boolean {
  const measure = verdict.measure;
  if (!measure) return true;
  const agreed = agreedForgeWishSubject(measure);
  if (agreed.motif === 'none') return false;
  if (agreed.motif === 'disputed' || agreed.motif !== measure.plan.motif) return true;
  if (forgeMeasureSlotMissed(measure) && measure.slotAvailable
    && measure.words.slot !== 'none' && measure.words.slot !== 'unclear') return fits({ motif: measure.plan.motif, kind: measure.words.slot });
  return (measure.certificate === 'unread' || measure.certificate === 'uncertified')
    && Boolean(forgeReadableFinishes(family, revision)[measure.plan.motif]?.length);
}
/** Finite feedback for a quiet redraft, derived from the gates' readings; never model prose or the wish. */
export function forgeRedraftFeedback(reason: 'fit' | 'quality' | 'subject', words: ForgeSubjectReading | undefined, last?: JudgeVerdict): string {
  if (reason === 'fit') return 'The first shape did not fit the available house socket. Choose a simpler authored part that fits; preserve the original subject where the kit allows it.';
  const lines: string[] = [];
  const motif = words && words.motif !== 'none' && words.motif !== 'unclear' ? words.motif : undefined;
  if (motif) lines.push(`The wish asks for ${motifWords[motif]}, and the kit has that subject: use motif ${motif} with interpretation as-wished.`);
  if (words && words.slot !== 'none' && words.slot !== 'unclear') lines.push(`The wish names the ${words.slot}: use kind ${words.slot} if it is among the sockets.`);
  if (last?.measure?.certificate === 'unread') lines.push('The previous finish hid the motif in this kingdom: choose one of the readable finishes listed above.');
  if (!lines.length) lines.push('Keep the subject the wish names when the kit has it; otherwise choose the closest authored motif honestly.');
  return `${lines.join(' ')} The title and plaque must describe the actual motif.`;
}
