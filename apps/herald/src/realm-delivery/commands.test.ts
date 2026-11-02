import { CHAT_COMMAND_MAX_AGE_MS, CHAT_COMMAND_ROUTE, ChatCommandEnvelopeSchema, KingdomIdSchema, PersonIdSchema, type ChatCommandEnvelope } from '@chatdom/shared';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RealmDelivery } from './delivery';

const kingdomId = KingdomIdSchema.parse('123'), start = 1_800_000_000_000;
const command: ChatCommandEnvelope = { version: 1, kind: 'command', origin: 'simulated', kingdomId, messageId: 'chat-exact-id', at: start,
  chatter: { twitchId: PersonIdSchema.parse('789'), login: 'simulated_chatter', displayName: 'SIMULATED Chatter' }, command: 'future-game', arg: '4' };
const cleanup: ChatCommandEnvelope = { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'cleanup-receipt', at: start,
  twitchId: PersonIdSchema.parse('789'), reason: 'delete', targetMessageId: 'chat-exact-id' };
async function rig() {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-command-delivery-'));
  const clock = { now: start }, service = { status: 503, result: 'busy' };
  const attempts: Array<{ path: string; body: unknown }> = [];
  const options = { url: 'http://127.0.0.1:5191', secret: 'simulated-command-secret-000000000000', directory, origin: 'simulated' as const,
    now: () => clock.now, retryMs: 1000, fetch: (async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer simulated-command-secret-000000000000');
      const path = new URL(String(url)).pathname, body: unknown = JSON.parse(String(init?.body));
      attempts.push({ path, body });
      return Response.json({ status: path === CHAT_COMMAND_ROUTE ? service.result : 'accepted' }, { status: path === CHAT_COMMAND_ROUTE ? service.status : 202 });
    }) as typeof fetch };
  return { options, directory, clock, service, attempts, files: async () => (await readdir(directory)).filter(file => file.endsWith('.json')),
    dispose: () => rm(directory, { recursive: true, force: true }) };
}

describe('durable generic commands', () => {
  it('persists exact command syntax, retries independently, and reloads the fixed route after restart', async () => {
    const r = await rig(); let sender = await RealmDelivery.open(r.options);
    try {
      await sender.command(command); await sender.flush();
      await sender.observation({ version: 1, id: 'presence', kingdomId, origin: 'simulated', observedAt: start, kind: 'stream', live: true, sessionId: 'SIMULATED' });
      await sender.flush();
      expect(sender.health()).toMatchObject({ commands: 1, pending: 1, fault: 'delivery', counters: { delivered: 1 } });
      await sender.close();
      const files = await r.files(); expect(files).toHaveLength(1);
      expect(ChatCommandEnvelopeSchema.parse(JSON.parse(await readFile(join(r.directory, files[0]!), 'utf8')))).toEqual(command);
      r.clock.now += 1000; r.service.status = 202; r.service.result = 'accepted';
      sender = await RealmDelivery.open(r.options); await sender.flush();
      expect(r.attempts.filter(attempt => attempt.path === CHAT_COMMAND_ROUTE)).toEqual([
        { path: CHAT_COMMAND_ROUTE, body: command }, { path: CHAT_COMMAND_ROUTE, body: command }]);
      expect(sender.health()).toMatchObject({ pending: 0, commands: 0, fault: null });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.dispose(); }
  });

  it('expires commands from their original event time before posting, while late cleanup survives restart', async () => {
    const r = await rig(); let sender = await RealmDelivery.open(r.options);
    try {
      await sender.command(command); await sender.command(cleanup); await sender.flush();
      expect(sender.health()).toMatchObject({ commands: 1, commandCleanups: 1 });
      await sender.close();
      r.clock.now += CHAT_COMMAND_MAX_AGE_MS;
      const before = r.attempts.length;
      sender = await RealmDelivery.open(r.options); await sender.flush();
      expect(r.attempts.slice(before)).toEqual([{ path: CHAT_COMMAND_ROUTE, body: cleanup }]);
      expect(sender.health()).toMatchObject({ commands: 0, commandCleanups: 1, counters: { expired: 1 } });
      await sender.close();
      r.clock.now += 24 * 60 * 60_000; r.service.status = 202; r.service.result = 'accepted';
      sender = await RealmDelivery.open(r.options); await sender.flush();
      expect(r.attempts.at(-1)).toEqual({ path: CHAT_COMMAND_ROUTE, body: cleanup });
      expect(sender.health()).toMatchObject({ pending: 0, commandCleanups: 0, counters: { delivered: 1, expired: 0 } });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.dispose(); }
  });

  it.each([command, cleanup])('treats ignored command-route acknowledgement as terminal for $kind', async envelope => {
    const r = await rig(); r.service.status = 202; r.service.result = 'ignored';
    const sender = await RealmDelivery.open(r.options);
    try {
      await sender.command(envelope); await sender.flush();
      expect(sender.health()).toMatchObject({ pending: 0, counters: { accepted: 1, delivered: 1, retries: 0 } });
      expect(await r.files()).toEqual([]);
      r.clock.now += 24 * 60 * 60_000; await sender.flush();
      expect(r.attempts).toHaveLength(1);
    } finally { await sender.close(); await r.dispose(); }
  });

  it('rejects failed persistence and closed delivery without claiming acceptance, then permits retry', async () => {
    const r = await rig(); const sender = await RealmDelivery.open(r.options);
    try {
      await rm(r.directory, { recursive: true });
      await expect(sender.command(command)).rejects.toThrow('persist');
      expect(sender.health()).toMatchObject({ pending: 0, fault: 'storage', counters: { accepted: 0, refused: 1 } });
      await sender.close();
      await expect(sender.command(cleanup)).rejects.toThrow('closed');
      expect(sender.health().counters.refused).toBe(2);
      expect(r.attempts).toHaveLength(0);
    } finally { await sender.close(); await r.dispose(); }
  });

  it('retries cleanup on its own clock when realm availability changes', async () => {
    const r = await rig(); const sender = await RealmDelivery.open(r.options);
    try {
      await sender.command(cleanup); await sender.flush();
      r.clock.now += 1000; r.service.status = 202; r.service.result = 'duplicate';
      await sender.flush();
      await vi.waitFor(() => expect(sender.health().pending).toBe(0));
      expect(r.attempts).toEqual([{ path: CHAT_COMMAND_ROUTE, body: cleanup }, { path: CHAT_COMMAND_ROUTE, body: cleanup }]);
    } finally { await sender.close(); await r.dispose(); }
  });
});
