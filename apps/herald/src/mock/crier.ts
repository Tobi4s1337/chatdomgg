import type { KingdomId } from '@chatdom/shared';
import type { AuthReport } from '../auth/authority';
import { RaidCrierWorker, RecordingRaidCrierTransport } from '../raid-gate/crier';
import type { RealmDelivery } from '../realm-delivery/delivery';
import { MOCK_READER_ID } from './door';

/** Private mock-door wiring: invented grants are confined to a simulated worker with a recording-only transport. */
export function createMockRaidCrier(options: { readonly kingdomId: KingdomId; readonly realm: RealmDelivery;
  readonly now?: () => number; readonly fetch?: typeof fetch }) {
  if (options.realm.options.origin !== 'simulated') throw new Error('The mock crier requires a simulated realm outbox');
  const now = options.now ?? Date.now, login = 'mock_kingdom';
  const report = (): AuthReport => ({ observedAt: now(), ok: true, problems: [],
    appToken: { state: 'valid', expiresAt: now() + 60_000 },
    accounts: {
      reader: { role: 'reader', login: 'mock_crier', id: MOCK_READER_ID, displayName: 'Mock Crier', state: 'resolved',
        authorized: true, granted: ['user:bot', 'user:read:chat', 'user:write:chat'] },
      broadcaster: { role: 'broadcaster', login, id: options.kingdomId, displayName: 'Mock Kingdom', state: 'resolved',
        authorized: true, granted: ['channel:bot'] },
    }, capabilities: [], otherScopes: { reader: [], broadcaster: [] }, failures: [],
  });
  const transport = new RecordingRaidCrierTransport();
  const worker = new RaidCrierWorker({ origin: 'simulated', kingdomId: options.kingdomId, login, enabled: true,
    report, realm: options.realm.options, transport, now, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return { worker, transport, health: () => ({ ...worker.health(), recorded: transport.records }) };
}
