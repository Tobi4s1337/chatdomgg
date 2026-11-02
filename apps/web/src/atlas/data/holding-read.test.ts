// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryError } from './directory';
import type { PreviewSource } from './preview';

// The survey and the register are stood in for here; only how /kingdom/<id> names a failed read is under test.
const fetchCard = vi.fn();
vi.mock('./directory', async original => ({ ...await original<typeof import('./directory')>(), fetchCard: (...args: unknown[]) => fetchCard(...args) }));
vi.mock('./load', () => ({ loadPreview: async () => ({ world: { id: 'pv-test', revision: 'obs-test', status: 'preview', regions: [] } }) }));
vi.mock('./preview', async original => ({ ...await original<typeof import('./preview')>(), fetchNames: async () => ({}), fetchChunk: async () => ({}) }));
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(),
  SettlerStore: class { byId = new Map(); applyNames() {} hasRegion() { return true; } addChunk() {} } }));

const { HoldingError, readDoorHolding } = await import('./holding');
const source = {} as PreviewSource;

describe('reading the door of a channel the survey has not mapped', () => {
  beforeEach(() => { fetchCard.mockReset(); });

  it('names a channel neither the register nor Twitch knows as missing, not as an Atlas that could not be read', async () => {
    fetchCard.mockRejectedValue(new DirectoryError('not-found', 'Not on the map yet.'));
    await expect(readDoorHolding(source, null, '999999999999')).rejects.toMatchObject({ reason: 'missing' });
  });

  it('still says the Atlas could not be read when the register is down', async () => {
    fetchCard.mockRejectedValue(new DirectoryError('unavailable', 'The register could not be read.'));
    const failure = readDoorHolding(source, null, '129634568');
    await expect(failure).rejects.toBeInstanceOf(HoldingError);
    await expect(failure).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
