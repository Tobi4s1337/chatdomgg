import type { ForgeCertificateGrade } from '../providers/policy';
import { FORGE_CERTIFICATE_DATA } from './data';
import { forgeCertificateGeometry } from './geometry';
import { FORGE_CERTIFICATE_FAMILIES, FORGE_CERTIFICATE_POLICY, gradeForgeCertificate, type ForgeCertificateFamily, type ForgeCertificateFinish,
  type ForgeCertificateMotif } from './protocol';
export * from './protocol';
export { forgeCertificateGeometry } from './geometry';

/**
 * The blind likeness grade of one authored motif, in one kingdom family, finish and kit revision.
 * Grades are recomputed from the stored counts, so an edited grade cannot certify a motif.
 */
export function forgeMotifCertificate(family: string, kitRevision: number, motif: string, finish: string): ForgeCertificateGrade {
  const kit = FORGE_CERTIFICATE_DATA.policy === FORGE_CERTIFICATE_POLICY ? FORGE_CERTIFICATE_DATA.kits[`${family}-native@${kitRevision}`] : undefined;
  const entry = kit?.[`${motif}/${finish}`];
  if (!entry || !(FORGE_CERTIFICATE_FAMILIES as readonly string[]).includes(family)) return 'uncertified';
  try {
    if (forgeCertificateGeometry(family as ForgeCertificateFamily, kitRevision).get(`${motif}/${finish}`) !== entry.geometry) return 'uncertified';
  } catch { return 'uncertified'; }
  try { return gradeForgeCertificate(entry.correct, entry.rounds); } catch { return 'uncertified'; }
}
/** Finishes in which a motif reads clearly in this family, offered to the drafter as plain guidance. */
export function forgeReadableFinishes(family: ForgeCertificateFamily, kitRevision: number): Partial<Record<ForgeCertificateMotif, ForgeCertificateFinish[]>> {
  const kit = FORGE_CERTIFICATE_DATA.kits[`${family}-native@${kitRevision}`];
  if (!kit || FORGE_CERTIFICATE_DATA.policy !== FORGE_CERTIFICATE_POLICY) return {};
  const result: Partial<Record<ForgeCertificateMotif, ForgeCertificateFinish[]>> = {};
  // Clear reads first; where a motif has none, its weak-but-recognised finishes are the best on offer.
  for (const grade of ['reads', 'weak'] as const) for (const key of Object.keys(kit).sort()) {
    const [motif, finish] = key.split('/') as [ForgeCertificateMotif, ForgeCertificateFinish];
    if (grade === 'weak' && result[motif]) continue;
    if (forgeMotifCertificate(family, kitRevision, motif, finish) === grade) (result[motif] ??= []).push(finish);
  }
  return result;
}
