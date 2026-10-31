import { KingdomIdSchema, PersonIdSchema, type PresenceInput } from '@chatdom/shared';
import { RealmHeraldEnvelopeSchema } from '@chatdom/shared/realm';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ChatIngest } from '../ingest/ingest';
import { planSubscriptions, type HeraldEventType } from '../ingest/subscriptions';
import { MemoryBindingStore } from '../source/bindings';
import { PresenceSource } from '../source/source';
import { RealmDelivery } from './delivery';

it('signs person-bound transient delivery, sends cleanup immediately, and retries only normalized durable evidence after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-herald-delivery-'));
  const kingdomId = KingdomIdSchema.parse('123'), now = 1_800_000_000_000;
  const secret = 'simulated-service-secret-000000000000';
  const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let available = false;
  const request: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${secret}`);
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (path.endsWith('/herald')) expect(RealmHeraldEnvelopeSchema.safeParse(body).success).toBe(true);
    attempts.push({ path, body });
    return Response.json({ version: 1, status: available ? 'accepted' : 'busy' }, { status: available ? 202 : 503 });
  };
  const options = { url: 'http://127.0.0.1:5191', secret, directory, origin: 'live' as const, fetch: request, now: () => now, retryMs: 60_000 };
  let sender = await RealmDelivery.open(options);
  const source = new PresenceSource({ kingdomId, origin: 'live', slots: [], store: new MemoryBindingStore(), realm: sender, now: () => now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'simulated-client' });
  const ingest = new ChatIngest({ source, conduitId: 'simulated-conduit', clientId: 'simulated-client', plans,
    covered: () => true, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, realm: sender, now: () => now });
  let sequence = 0;
  const deliver = (type: HeraldEventType, event: Record<string, unknown>) => {
    const plan = plans.find(plan => plan.type === type)!;
    ingest.handle({ kind: 'notification', meta: { messageId: `delivery-${++sequence}`, at: now },
      subscription: { id: 'simulated-subscription', status: 'enabled', type, version: plan.version,
        condition: plan.condition, conduitId: 'simulated-conduit' }, event: { broadcaster_user_id: kingdomId, ...event } });
  };
  try {
    await source.open(); source.setAvailable(true);
    await source.submit({ version: 1, id: 'stream:start', kingdomId, kind: 'stream', origin: 'live', observedAt: now, live: true, sessionId: 'session:simulated' });
    deliver('channel.chat.message', { chatter_user_id: '789', chatter_user_name: 'SIMULATED', message_id: 'speech-1',
      message: { text: 'SIMULATED ordinary speech' } });
    deliver('channel.chat.message', { chatter_user_id: '789', chatter_user_name: 'SIMULATED', message_id: 'wish-1',
      message: { text: '!forge SIMULATED private copper dragon' } });
    await vi.waitFor(() => expect(attempts.filter(attempt => 'chat' in attempt.body || 'forge' in attempt.body)).toHaveLength(2));
    const chat = attempts.find(attempt => 'chat' in attempt.body)!.body.chat;
    expect(chat).toMatchObject({ id: 'speech-1', personId: '789' });
    expect(chat).not.toHaveProperty('slot'); expect(chat).not.toHaveProperty('epoch');
    expect(JSON.stringify(chat)).not.toContain('copper dragon');
    expect(attempts.find(attempt => 'forge' in attempt.body)!.body).toMatchObject({ forge: { type: 'wish', origin: 'live', command: { personId: '789', slot: 0, words: 'SIMULATED private copper dragon' } } });
    // With no source presentation slots, the wish still reaches actual Realm home authority.
    expect(source.boundSlot(PersonIdSchema.parse('789'))).toBeNull();
    deliver('channel.chat.message_delete', { target_user_id: '789', message_id: 'wish-1' });
    deliver('channel.chat.clear_user_messages', { target_user_id: '789' });
    deliver('channel.chat.clear', {});
    await vi.waitFor(() => expect(sender.health().counters.accepted).toBe(4));
    source.setAvailable(false, 'chat_delivery_down');
    await source.close();
    await vi.waitFor(() => expect(sender.health().transient).toBe(0));
    await sender.close();
    const transient = attempts.filter(attempt => attempt.path.endsWith('/herald'));
    expect(transient.some(attempt => 'forge' in attempt.body && (attempt.body.forge as { type: string }).type === 'cancel')).toBe(true);
    expect(transient.some(attempt => 'chatCleanup' in attempt.body && (attempt.body.chatCleanup as { personId?: string }).personId === '789')).toBe(true);
    const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
    const retained = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')));
    expect(retained.length).toBeGreaterThan(3);
    expect(retained.join('')).not.toContain('ordinary speech');
    expect(retained.join('')).not.toContain('copper dragon');
    const normalized = retained.map(text => JSON.parse(text) as PresenceInput);
    expect(normalized.some(input => input.kind === 'source-lost')).toBe(true);
    expect(normalized.some(input => input.kind === 'remove')).toBe(true);
    const beforeRestart = attempts.length;
    available = true;
    sender = await RealmDelivery.open(options);
    await sender.flush();
    expect(sender.health().pending).toBe(0);
    expect(attempts.slice(beforeRestart)).toHaveLength(files.length);
    expect(attempts.slice(beforeRestart).every(attempt => attempt.path.endsWith('/ingress'))).toBe(true);
    const replayed = attempts.slice(beforeRestart).map(attempt => attempt.body.observation as PresenceInput);
    expect(replayed.map(input => input.id).sort()).toEqual(normalized.map(input => input.id).sort());
    expect(replayed[0]?.kind).toBe('remove');
    expect((await readdir(directory)).filter(file => file.endsWith('.json'))).toEqual([]);
  } finally {
    ingest.dispose(); await source.close(); await sender.close();
    await rm(directory, { recursive: true, force: true });
  }
});
