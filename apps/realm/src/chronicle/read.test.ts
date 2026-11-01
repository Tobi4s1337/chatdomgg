import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { KingdomIdSchema } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import type { DurableRealmServices } from '../persistence';
import type { AllocationService } from '../allocation';
import type { FileFoundedStore } from '../founded';
import { FoundedReadError } from '../bootstrap/founded';
import { createChronicleReader } from './read';
const kingdomId = KingdomIdSchema.parse('999000001');
const manifest: RealmFoundedManifest = { version: 1, kingdomId, origin: 'simulated', layoutRevision: 'layout', collisionRevision: 0, sceneHash: 'a'.repeat(64) };
function setup(throughSequence = 0) {
  const release = vi.fn(async () => {}), retain = vi.fn(async () => ({ kingdom: { current: true, publicCheckpoint: () => ({ throughSequence }) }, release }));
  const query = vi.fn<(...args: unknown[]) => Promise<{ rows: never[] }>>(async () => ({ rows: [] })), authorize = vi.fn(async () => manifest);
  const reader = createChronicleReader({ origin: 'simulated', pool: { query } as unknown as Pick<Pool, 'query'>,
    services: { retain } as unknown as Pick<DurableRealmServices, 'retain'>, founded: { manifest: authorize },
    allocation: {} as Pick<AllocationService, 'layoutPlan'>, store: {} as Pick<FileFoundedStore, 'native'> });
  return { reader, release, retain, query, authorize };
}
const request = { authorization: '', cookie: '', origin: '' };
it('authorizes before retaining authority and rechecks withdrawal before returning even an empty history', async () => {
  const s = setup();
  s.authorize.mockRejectedValueOnce(new FoundedReadError(403, 'withdrawn'));
  await expect(s.reader.read(kingdomId, request)).rejects.toThrow('withdrawn');
  expect(s.retain).not.toHaveBeenCalled();
  s.authorize.mockResolvedValueOnce(manifest).mockRejectedValueOnce(new FoundedReadError(403, 'withdrawn during read'));
  await expect(s.reader.read(kingdomId, request)).rejects.toThrow('withdrawn during read');
  expect(s.release).toHaveBeenCalledTimes(1);
});
it('reads only the delivered sequence and never substitutes empty success for an incomplete durable prefix', async () => {
  const s = setup(7);
  await expect(s.reader.read(kingdomId, request)).rejects.toThrow(/gap/);
  expect(s.query.mock.calls[0]?.[1]).toEqual([kingdomId, 7, 100001]);
  expect(s.release).toHaveBeenCalledTimes(1);
});
it('returns explicit simulated provenance with no private epoch or service state in an empty kingdom', async () => {
  const s = setup();
  const reply = await s.reader.read(kingdomId, request);
  expect(reply).toEqual({ version: 1, kingdomId, origin: 'simulated', throughSequence: 0, history: { label: 'SIMULATED', snapshots: [] }, worlds: [] });
  expect(s.authorize).toHaveBeenCalledTimes(2);
  expect(s.release).toHaveBeenCalledTimes(1);
});
