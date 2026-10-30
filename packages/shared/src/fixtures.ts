import { AtlasEditionSchema, AtlasSettlerSchema, AtlasManifestSchema, AtlasLiveStartsSchema } from './atlas';
import { createAtlasAlignment, encodeDabsV1, encodeLiveV2, sha256Hex } from './atlas-binary';

/** All invented channel IDs/names are test data. Any fixture surface must show this label. */
export const SIMULATED_ATLAS_LABEL = 'SIMULATED' as const;
export const FIXTURE_AS_OF = 1_793_318_400_000;

export async function createSimulatedAtlasFixture() {
  const edition = AtlasEditionSchema.parse({
    version: 1, id: 'simulated-edition', label: 'SIMULATED', status: 'preview',
    foundedAt: FIXTURE_AS_OF - 86_400_000, worldHash: 'a'.repeat(64), realmCount: 2,
  });
  const settlers = [
    AtlasSettlerSchema.parse({ ordinal: 0, kingdomId: '90000000000000001', holdingId: 'holding-0', realmIndex: 0,
      holdingTier: 'hamlet', point: { x: 40, y: 30 }, settledAt: edition.foundedAt }),
    AtlasSettlerSchema.parse({ ordinal: 1, kingdomId: '90000000000000002', holdingId: 'holding-1', realmIndex: 1,
      holdingTier: 'capital', point: { x: 300, y: 200 }, settledAt: edition.foundedAt }),
    AtlasSettlerSchema.parse({ ordinal: 2, kingdomId: '90000000000000003', holdingId: 'holding-2', realmIndex: 1,
      holdingTier: 'town', point: { x: 340, y: 200 }, settledAt: edition.foundedAt }),
  ];
  const alignment = await createAtlasAlignment(edition, settlers);
  const slots = [{ liveClass: 5 as const, spectacle: 0 }, { liveClass: 1 as const, spectacle: 4 }, { liveClass: 0 as const, spectacle: 6 }];
  const live = encodeLiveV2(slots);
  const starts = AtlasLiveStartsSchema.parse({ version: 1, alignment, asOf: FIXTURE_AS_OF,
    entries: [{ ordinal: 0, startedAt: FIXTURE_AS_OF - 120_000 }, { ordinal: 1, startedAt: null }] });
  const startsBytes = new TextEncoder().encode(JSON.stringify(starts));
  const dabEntries = [{ realmIndex: 0, channelHash: '0011223344556677', startedAt: FIXTURE_AS_OF - 60_000 }];
  const dabs = encodeDabsV1(dabEntries);
  const manifest = AtlasManifestSchema.parse({
    version: 1, alignment, evidence: { kind: 'simulated', asOf: FIXTURE_AS_OF, label: SIMULATED_ATLAS_LABEL },
    publishedAt: FIXTURE_AS_OF + 100, realmCount: edition.realmCount, coverage: 'complete-sweep',
    live: { format: 'live-v2', path: '/atlas/test/live.bin', sha256: await sha256Hex(live), byteLength: live.byteLength },
    starts: { format: 'live-starts-v1', path: '/atlas/test/live-starts.json', sha256: await sha256Hex(startsBytes), byteLength: startsBytes.byteLength },
    dabs: { format: 'dabs-v1', count: dabEntries.length, path: '/atlas/test/dabs.bin', sha256: await sha256Hex(dabs), byteLength: dabs.byteLength },
  });
  return { label: SIMULATED_ATLAS_LABEL, edition, settlers, alignment, slots, live, starts, startsBytes, dabs, dabEntries, manifest };
}
