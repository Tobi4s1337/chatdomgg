import { describe, expect, it } from 'vitest';
import { createConfigurationHelper } from './helper';
import { createConfigTransport } from './transport';
import { DEFAULT_SETTINGS } from './schema';
import type { HelperBridge } from '../helper';

function fixture(mode: 'echo' | 'mismatch' | 'none' | 'conflict' | 'refused' = 'echo') {
  let changed = () => {}, segment: { version: string; content: string } | undefined;
  const config = createConfigurationHelper({ get broadcaster() { return segment; }, onChanged(cb) { changed = cb; }, set(_segment, version, content) { if (mode === 'none') return; segment = { version, content: mode === 'mismatch' ? '{}' : content }; changed(); } });
  const helper: HelperBridge = { token: () => 'private', authorization: () => 1, status: () => ({ kind: 'authorized', loggedIn: true, shared: true, role: 'broadcaster', bits: true }), subscribe: () => () => {}, requestIdShare: () => false };
  const current = { version: 1, status: 'settings', revision: '1', settings: DEFAULT_SETTINGS, connected: true };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(mode === 'conflict' ? { version: 1, status: 'conflict', current } : mode === 'refused' ? { status: 'refused' } : current), { status: mode === 'refused' ? 403 : 200 });
  return createConfigTransport(helper, config, 'https://example.test', fetcher, 5);
}
describe('configuration confirmation', () => {
  it('requires the realm acknowledgement and matching Twitch echo', async () => { expect((await fixture().save('0', DEFAULT_SETTINGS)).kind).toBe('saved'); });
  it.each(['mismatch', 'none'] as const)('leaves %s echo pending', async mode => { expect((await fixture(mode).save('0', DEFAULT_SETTINGS)).kind).toBe('pending'); });
  it('surfaces a conflict with the latest reading', async () => { expect((await fixture('conflict').save('0', DEFAULT_SETTINGS)).kind).toBe('conflict'); });
  it('abandons an old authorization while waiting for an echo', async () => {
    let notify = () => {}, authorization = 1;
    const helper: HelperBridge = { token: () => 'private', authorization: () => authorization, status: () => ({ kind: 'authorized', loggedIn: true, shared: true, role: 'broadcaster', bits: true }), subscribe: cb => { notify = () => cb(helper.status()); return () => {}; }, requestIdShare: () => false };
    const config = createConfigurationHelper({ onChanged() {}, set() {} });
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ version: 1, status: 'settings', revision: '1', settings: DEFAULT_SETTINGS, connected: true }));
    const pending = createConfigTransport(helper, config, 'https://example.test', fetcher, 100).save('0', DEFAULT_SETTINGS);
    await new Promise(resolve => setTimeout(resolve, 0)); authorization++; notify();
    expect((await pending).kind).toBe('changed');
  });
  it('times out a request even when the provider ignores abort', async () => {
    const helper: HelperBridge = { token: () => 'private', authorization: () => 1, status: () => ({ kind: 'waiting' }), subscribe: () => () => {}, requestIdShare: () => false };
    const hung: typeof fetch = () => new Promise(() => {});
    const transport = createConfigTransport(helper, createConfigurationHelper(undefined), 'https://example.test', hung, 50, 5);
    expect(await transport.read()).toBeNull();
  });
  it('disposes pending echo immediately', async () => {
    const helper: HelperBridge = { token: () => 'private', authorization: () => 1, status: () => ({ kind: 'waiting' }), subscribe: () => () => {}, requestIdShare: () => false };
    let written = () => {}; const writing = new Promise<void>(resolve => { written = resolve; });
    const config = createConfigurationHelper({ onChanged() {}, set() { written(); } });
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ version: 1, status: 'settings', revision: '1', settings: DEFAULT_SETTINGS, connected: true }));
    const transport = createConfigTransport(helper, config, 'https://example.test', fetcher, 10000);
    const pending = transport.save('0', DEFAULT_SETTINGS); await writing; transport.dispose();
    expect((await pending).kind).toBe('changed');
  });
  it('discards a read from an old identity', async () => {
    let authorization = 1, respond!: (response: Response) => void;
    const helper: HelperBridge = { token: () => 'private', authorization: () => authorization, status: () => ({ kind: 'waiting' }), subscribe: () => () => {}, requestIdShare: () => false };
    const fetcher: typeof fetch = () => new Promise(resolve => { respond = resolve; });
    const transport = createConfigTransport(helper, createConfigurationHelper(undefined), 'https://example.test', fetcher);
    const pending = transport.read(); authorization++;
    respond(new Response(JSON.stringify({ version: 1, status: 'settings', revision: '1', settings: DEFAULT_SETTINGS, connected: true })));
    expect(await pending).toBeNull();
  });
  it('rejects an oversized response', async () => {
    const helper: HelperBridge = { token: () => 'private', status: () => ({ kind: 'waiting' }), subscribe: () => () => {}, requestIdShare: () => false };
    const fetcher: typeof fetch = async () => new Response('x'.repeat(16385));
    expect(await createConfigTransport(helper, createConfigurationHelper(undefined), 'https://example.test', fetcher).read()).toBeNull();
  });
  it.each(['before echo', 'after echo'] as const)('does not confirm a newer Hide arriving %s', async timing => {
    const helper: HelperBridge = { token: () => 'private', authorization: () => 1, status: () => ({ kind: 'waiting' }), subscribe: () => () => {}, requestIdShare: () => false };
    const old = { version: 1, status: 'settings', revision: '1', settings: DEFAULT_SETTINGS, connected: true };
    const newer = { ...old, revision: '2', settings: { ...DEFAULT_SETTINGS, hidden: true } };
    let callback = () => {}, segment: { version: string; content: string } | undefined, writes = 0, reads = 0;
    const config = createConfigurationHelper({ get broadcaster() { return segment; }, onChanged(cb) { callback = cb; }, set(_segment, version, content) { writes++; segment = { version, content }; callback(); } });
    const fetcher: typeof fetch = async input => {
      const path = String(input); const value = path.endsWith('/configure') ? old : (++reads === 1 && timing === 'after echo' ? old : newer);
      return new Response(JSON.stringify(value));
    };
    const result = await createConfigTransport(helper, config, 'https://example.test', fetcher).save('0', DEFAULT_SETTINGS);
    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') expect(result.reading.settings.hidden).toBe(true);
    expect(writes).toBe(timing === 'before echo' ? 0 : 1);
  });
  it('surfaces refusal', async () => { expect((await fixture('refused').save('0', DEFAULT_SETTINGS)).kind).toBe('refused'); });
});
