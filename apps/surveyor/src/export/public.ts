import { z } from 'zod';
import { EpochMsSchema, UIntSchema } from '@chatdom/shared';
import { RevisionIdSchema, type SnapshotManifest } from './schema';

/**
 * What the browser may learn about the current observation snapshot: dates, coverage and aggregate counts.
 * No source paths or hosts, no channel rows, no rejected-row samples. Strict, so additions are deliberate.
 */
export const PublicSurveySchema = z.strictObject({
  version: z.literal(1),
  revision: RevisionIdSchema,
  asOf: EpochMsSchema,
  window: z.strictObject({
    firstObservationAt: EpochMsSchema, lastObservationAt: EpochMsSchema, hours: z.number().min(0),
    sweeps: UIntSchema, gapCount: UIntSchema,
  }),
  coverage: z.strictObject({
    sweepFloorViewers: UIntSchema,
    raidWatch: z.strictObject({ enabled: z.boolean(), watching: UIntSchema, liveCandidates: UIntSchema }),
    contentLabels: z.literal('not-collected'),
    missing: z.array(z.string().max(300)).max(20),
  }),
  founding: z.strictObject({ status: z.literal('not-founded'), edition0EligibleAt: EpochMsSchema, editionIEligibleAt: EpochMsSchema }),
  counts: z.strictObject({
    channels: UIntSchema, kingdomCandidates: UIntSchema, liveChannels: UIntSchema, liveCandidates: UIntSchema,
    raidPairs: UIntSchema, raidObservations: UIntSchema,
  }),
});
export type PublicSurvey = z.infer<typeof PublicSurveySchema>;

export function publicSurvey(manifest: SnapshotManifest): PublicSurvey {
  const { window, coverage, founding, counts } = manifest;
  return PublicSurveySchema.parse({
    version: 1,
    revision: manifest.revision,
    asOf: manifest.asOf,
    window: {
      firstObservationAt: window.firstObservationAt, lastObservationAt: window.lastObservationAt, hours: window.hours,
      sweeps: window.sweeps, gapCount: window.gapCount,
    },
    coverage: {
      sweepFloorViewers: coverage.sweep.floorViewers,
      raidWatch: { enabled: coverage.raidWatch.enabled, watching: coverage.raidWatch.watching, liveCandidates: coverage.raidWatch.liveCandidates },
      contentLabels: coverage.contentLabels,
      missing: coverage.missing,
    },
    founding: { status: founding.status, edition0EligibleAt: founding.edition0EligibleAt, editionIEligibleAt: founding.editionIEligibleAt },
    counts: {
      channels: counts.channels, kingdomCandidates: counts.kingdomCandidates, liveChannels: counts.liveChannels,
      liveCandidates: counts.liveCandidates, raidPairs: counts.raidPairs, raidObservations: counts.raidObservations,
    },
  });
}
