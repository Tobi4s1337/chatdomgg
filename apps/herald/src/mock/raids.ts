import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import type { Secret } from '@chatdom/twitch';
import { createRaidAuthorityRoute, type RaidAuthority } from '../raid-gate/raid-authority';
import { RaidWriteLedger, RaidWrites, RecordingRaidWire } from '../raid-gate/raids';

/** `HERALD_MOCK_LIVE_CHANNELS`: comma-separated Twitch IDs the bench treats as live. Null when any entry is not an ID. */
export function parseMockLiveChannels(raw: string | undefined): KingdomId[] | null {
  const entries = (raw ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  const ids: KingdomId[] = [];
  for (const entry of entries) {
    const parsed = KingdomIdSchema.safeParse(entry);
    if (!parsed.success) return null;
    ids.push(parsed.data);
  }
  return ids.length > 1000 ? null : [...new Set(ids)];
}

/**
 * The mock door's raid authority: the same private route and the same durable ledger as `herald dev`, over a
 * recording wire with no token and no network. Its kingdom's grant stands and the write consent is on (it is a
 * bench); every record carries `origin: 'simulated'`. A restarted mock still never writes a key twice.
 */
export async function createMockRaidAuthority(options: { readonly kingdomId: KingdomId; readonly dir: string; readonly repositoryRoot: string | null;
  readonly secret: Secret | null; readonly liveChannels: readonly KingdomId[]; readonly now?: () => number }) {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId);
  const ledger = await RaidWriteLedger.open({ dir: options.dir, repositoryRoot: options.repositoryRoot });
  const wire = new RecordingRaidWire(options.now);
  const writes = new RaidWrites({ ledger, wire, broadcasterId: kingdomId, ...(options.now ? { now: options.now } : {}) });
  const live = new Set<string>([kingdomId, ...options.liveChannels]);
  const authority: RaidAuthority = {
    origin: 'simulated', kingdomId, writes,
    standing: async () => ({ grant: 'granted', consent: 'enabled' }),
    live: async kingdomIds => Object.fromEntries(kingdomIds.map(id => [id, live.has(id)])),
  };
  return {
    authority,
    route: createRaidAuthorityRoute({ authority: () => authority, secret: options.secret }),
    health: () => ({ origin: 'simulated', configured: options.secret !== null, pending: wire.pending, counters: { ...writes.counters },
      ledgerFault: ledger.fault, recorded: writes.recent() }),
    close: () => ledger.close(),
  };
}
