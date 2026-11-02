import { describe, expect, it } from 'vitest';
import { createHeraldRaidAuthority } from './herald-authority';
import { createGateFanout } from './http';
import { createPolledGateFanout } from './gate-changes';
import type { KingdomId } from '../../../../packages/shared/src/identity';

const SECRET = 'a-long-enough-test-secret';
const from = '129634568' as KingdomId, to = '41' as KingdomId;
const write = { key: 'r1/start', requestId: 'r1', from, to };

function fake(answer: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, init, body });
    return answer(body);
  };
  return { calls, fetch };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('Herald raid authority client', () => {
  it('sends one strict write with the bearer secret and returns Herald\'s outcome', async () => {
    const { calls, fetch } = fake(() => json({ version: 1, origin: 'simulated', key: 'r1/start', outcome: { kind: 'accepted', createdAt: 1_000 } }));
    const herald = createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: SECRET, origin: 'simulated', fetch });
    expect(await herald.raids.start(write, new AbortController().signal)).toEqual({ kind: 'accepted', createdAt: 1_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:5180/internal/herald/raid-gate');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.body).toEqual({ version: 1, origin: 'simulated', op: 'start', write });
  });

  it('tells any answer it cannot vouch for as unknown, never as a refusal', async () => {
    for (const answer of [
      () => json({ version: 1, origin: 'simulated', key: 'other', outcome: { kind: 'accepted', createdAt: 1 } }),
      () => json({ version: 1, origin: 'live', key: 'r1/start', outcome: { kind: 'rejected', code: 'x' } }),
      () => json({ error: 'nope' }, 503),
      () => { throw new Error('connection reset'); },
      () => new Response('not json', { status: 200 }),
    ]) {
      const herald = createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: SECRET, origin: 'simulated', fetch: fake(answer).fetch });
      expect(await herald.raids.start(write, new AbortController().signal)).toEqual({ kind: 'unknown' });
    }
  });

  it('does not let the caller abort a write once it may have left', async () => {
    let seen: AbortSignal | undefined;
    const herald = createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: SECRET, origin: 'simulated', fetch: async (_url, init) => {
      seen = init.signal ?? undefined;
      return json({ version: 1, origin: 'simulated', key: 'r1/start', outcome: { kind: 'rejected', code: 'already-raiding' } });
    } });
    const caller = new AbortController();
    const pending = herald.raids.start(write, caller.signal);
    caller.abort();
    expect(await pending).toEqual({ kind: 'rejected', code: 'already-raiding' });
    expect(seen?.aborted).toBe(false);
  });

  it('reads standing once per short window and live state per channel', async () => {
    const { calls, fetch } = fake(body => body.op === 'standing'
      ? json({ version: 1, origin: 'simulated', kingdomId: from, grant: 'missing', consent: 'disabled' })
      : json({ version: 1, origin: 'simulated', live: { [from]: true, [to]: false } }));
    const herald = createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: SECRET, origin: 'simulated', fetch });
    const signal = new AbortController().signal;
    expect(await herald.grants.read(from, signal)).toBe('missing');
    expect(await herald.consent.read(from, signal)).toBe('disabled');
    expect(calls.filter(call => call.body.op === 'standing')).toHaveLength(1);
    expect([...await herald.live.read([from, to, from], signal)]).toEqual([[from, true], [to, false]]);
  });

  it('fails a live read that leaves a requested channel unanswered', async () => {
    const herald = createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: SECRET, origin: 'simulated',
      fetch: fake(() => json({ version: 1, origin: 'simulated', live: { [from]: true } })).fetch });
    await expect(herald.live.read([from, to], new AbortController().signal)).rejects.toThrow(/did not answer/);
  });

  it('refuses to bind without a secret', () => {
    expect(() => createHeraldRaidAuthority({ url: 'http://127.0.0.1:5180', secret: '', origin: 'live' })).toThrow(/SECRET/);
  });
});

describe('gate changes committed by another process', () => {
  it('announces a revision it has not seen while a stream watches, and stops reading once nobody does', async () => {
    let rows: { request_id: string; revision: string }[] = [{ request_id: 'r1', revision: '3' }];
    let reads = 0;
    const pool = { query: async () => { reads += 1; return { rows }; } };
    const fanout = createPolledGateFanout(createGateFanout(), { pool, everyMs: 0 });
    const heard: number[] = [];
    const stop = fanout.listen(from, change => heard.push(change.revision));
    await fanout.poll();
    expect(heard).toEqual([3]);
    await fanout.poll();
    expect(heard).toEqual([3]);
    rows = [{ request_id: 'r1', revision: '4' }];
    await fanout.poll();
    expect(heard).toEqual([3, 4]);
    // This process's own commit is announced once, and the next read does not repeat it.
    fanout.changed({ kingdomId: from, requestId: 'r1', revision: 5 });
    rows = [{ request_id: 'r1', revision: '5' }];
    await fanout.poll();
    expect(heard).toEqual([3, 4, 5]);
    stop();
    const before = reads;
    await fanout.poll();
    expect(reads).toBe(before);
  });
});
