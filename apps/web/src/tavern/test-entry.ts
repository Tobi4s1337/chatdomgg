import { RealmJoinSchema } from '@chatdom/shared/realm';
import { connectTavern } from './client';

/** Explicit loopback-only testing. The realm must actually expose its test session service. */
export async function openLocalTestTavern(params: URLSearchParams) {
  const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const endpoint = new URL(params.get('realm') ?? '/live-realm-data', location.origin);
  if (params.get('testWalker') !== '1' || !loopback(location.hostname) || !loopback(endpoint.hostname)) throw new Error('Enter the tavern from your kingdom.');
  const ticket = async () => {
    const response = await fetch(`${endpoint.toString().replace(/\/$/, '')}/reference/session`, { method: 'POST', cache: 'no-store' });
    if (!response.ok) throw new Error('This door does not admit test walkers.');
    return RealmJoinSchema.parse(await response.json());
  };
  const join = await ticket();
  const client = await connectTavern(endpoint.toString().replace(/\/$/, ''), {
    kingdomId: join.kingdomId, resumeScope: params.get('resumeScope') ?? crypto.randomUUID(), ticket: async () => join,
  }, sessionStorage);
  if (client.room.state.origin !== 'simulated') { client.dispose(); throw new Error('This door does not admit test walkers.'); }
  return client;
}
