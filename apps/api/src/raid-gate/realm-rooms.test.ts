import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import { REALM_ROOM_DOOR_ROUTE } from '../../../realm/src/raid-gate/room-door-contracts';
import { createRealmRoomsClient, realmRoomsUrl } from './realm-rooms';

const SECRET = 's'.repeat(40);
const ref = { ticket: 't1', personId: PersonIdSchema.parse('990100001'), sessionId: 'session', from: KingdomIdSchema.parse('990100101'),
  to: KingdomIdSchema.parse('990100201'), generation: 1, kind: 'raid' as const };
const signal = new AbortController().signal;
const client = (answer: (body: Record<string, unknown>) => Response, seen: { url?: string; authorization?: string | undefined } = {}) =>
  createRealmRoomsClient({ url: 'http://127.0.0.1:5199', secret: SECRET, origin: 'simulated', fetch: async (url, init) => {
    seen.url = url; seen.authorization = (init.headers as Record<string, string>).authorization;
    return answer(JSON.parse(String(init.body)) as Record<string, unknown>);
  } });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('the API\'s room transport over the realm\'s door', () => {
  it('asks the door with the service credential and carries its outcome', async () => {
    const seen: { url?: string; authorization?: string | undefined } = {};
    const rooms = client(body => reply({ version: 1, origin: 'simulated', op: body.op, subject: 't1', outcome: { kind: 'acknowledged', role: 'visitor', committedAt: 5 } }), seen);
    expect(await rooms.commit(ref, signal)).toEqual({ kind: 'acknowledged', role: 'visitor', committedAt: 5 });
    expect(seen).toEqual({ url: `http://127.0.0.1:5199${REALM_ROOM_DOOR_ROUTE}`, authorization: `Bearer ${SECRET}` });
  });

  it('throws on any answer it cannot vouch for, so the coordinator counts it unknown', async () => {
    await expect(client(() => reply({ status: 'unavailable' }, 503)).reconcile(ref, signal)).rejects.toThrow(/503/u);
    await expect(client(body => reply({ version: 1, origin: 'simulated', op: body.op, subject: 'another', outcome: { kind: 'committed' } })).reconcile(ref, signal)).rejects.toThrow(/another question/u);
    await expect(client(body => reply({ version: 1, origin: 'live', op: body.op, subject: 't1', outcome: { kind: 'committed' } })).reconcile(ref, signal)).rejects.toThrow(/another question/u);
    await expect(client(() => reply({ version: 1, origin: 'simulated', op: 'commit', subject: 't1', outcome: { kind: 'committed' } })).reconcile(ref, signal)).rejects.toThrow(/another question/u);
  });

  it('binds only a loopback or HTTPS realm, and refuses a short credential', () => {
    expect(realmRoomsUrl({ REALM_TRAVEL_URL: 'http://127.0.0.1:5197/x' })).toBe('http://127.0.0.1:5197');
    expect(realmRoomsUrl({ DOCK_REALM_URL: 'https://realm.example' })).toBe('https://realm.example');
    expect(realmRoomsUrl({ REALM_TRAVEL_URL: 'http://realm.example' })).toBeNull();
    expect(realmRoomsUrl({})).toBeNull();
    expect(() => createRealmRoomsClient({ url: 'http://127.0.0.1:1', secret: 'short', origin: 'live' })).toThrow();
  });
});
