import { describe, expect, it } from 'vitest';
// The craft entry has no JSX or CSS, so Vitest can read it without the Solid compiler.
import { createPassportSession, type PassportReadState } from '../../../../packages/ui/src/passport/craft';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { PANEL_PASSPORT_REPLY_LIMIT, PanelPassportUnauthorized, passportExtensionTransport } from './transport';

const URL = 'https://ebs.chatdom.example/passport';

/** A backend double that answers through the real reader for a SIMULATED holder, and records what it was sent. */
function backend(options: { status?: number; body?: (json: unknown) => string } = {}) {
  const sim = simulatedPassportAuthorities('many', { signedIn: true, travelsHidden: false });
  const reader = createPassportReader(sim.ports);
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchDouble: typeof fetch = async (input, init = {}) => {
    seen.push({ url: String(input), init });
    if (options.status && options.status !== 200) return new Response('no', { status: options.status });
    const reply = await reader.handle({ key: sim.key, now: sim.now, signal: init.signal ?? new AbortController().signal }, JSON.parse(String(init.body)));
    return new Response(options.body ? options.body(reply) : JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchDouble, seen };
}

const settle = async (read: () => PassportReadState, until: (state: PassportReadState) => boolean) => {
  for (let i = 0; i < 50 && !until(read()); i++) await new Promise(resolve => setTimeout(resolve, 0));
  return read();
};

describe('the panel reads the passport from the Extension backend', () => {
  it('signs each read with the latest Helper token, names nobody and sends no cookies', async () => {
    const server = backend();
    let token = 'helper-token-1';
    const transport = passportExtensionTransport({ url: URL, token: () => token, fetch: server.fetch });
    const reply = await transport({ op: 'book' }, new AbortController().signal);
    expect(reply?.kind).toBe('book');
    token = 'helper-token-2';
    await transport({ op: 'book' }, new AbortController().signal);
    const [first, second] = server.seen;
    expect(new Headers(first!.init.headers).get('authorization')).toBe('Bearer helper-token-1');
    expect(new Headers(second!.init.headers).get('authorization')).toBe('Bearer helper-token-2');
    expect(first!.init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    expect(JSON.parse(String(first!.init.body))).toEqual({ op: 'book' });
  });

  it('asks nothing before Twitch authorizes the view, and the reading stays closed as unavailable', async () => {
    const server = backend();
    const transport = passportExtensionTransport({ url: URL, token: () => null, fetch: server.fetch });
    await expect(transport({ op: 'book' }, new AbortController().signal)).rejects.toBeInstanceOf(PanelPassportUnauthorized);
    expect(server.seen).toHaveLength(0);
    const session = createPassportSession(transport);
    session.open();
    expect(await settle(session.state, state => state.kind !== 'pending')).toEqual({ kind: 'unavailable', cause: 'unavailable' });
  });

  it('turns a refused, oversized or unparsable answer into unavailable, never an empty book', async () => {
    for (const body of [
      (reply: unknown) => JSON.stringify({ ...(reply as object), book: { version: 1, origin: 'live', visibility: 'visible' } }),
      () => 'not json',
      () => `{"pad":"${'x'.repeat(PANEL_PASSPORT_REPLY_LIMIT)}"}`,
    ]) {
      const server = backend({ body });
      const transport = passportExtensionTransport({ url: URL, token: () => 'token', fetch: server.fetch });
      expect(await transport({ op: 'book' }, new AbortController().signal)).toBeUndefined();
      const session = createPassportSession(transport);
      session.open();
      expect(await settle(session.state, state => state.kind !== 'pending')).toEqual({ kind: 'unavailable', cause: 'malformed' });
    }
  });

  it('fails a read the backend refused with an error status', async () => {
    const server = backend({ status: 503 });
    const transport = passportExtensionTransport({ url: URL, token: () => 'token', fetch: server.fetch });
    await expect(transport({ op: 'book' }, new AbortController().signal)).rejects.toThrow('503');
  });

  it('opens a visible book and turns older journeys page by page through the panel transport', async () => {
    const server = backend();
    const session = createPassportSession(passportExtensionTransport({ url: URL, token: () => 'token', fetch: server.fetch }));
    session.open();
    const open = await settle(session.state, state => state.kind !== 'pending');
    expect(open.kind).toBe('visible');
    session.more('stamps');
    const turned = await settle(session.state, state => state.kind === 'visible' && !state.shelf.stamps.pending);
    expect(turned.kind === 'visible' && turned.shelf.stamps.items.length).toBe(90);
    expect(JSON.parse(String(server.seen[1]!.init.body))).toMatchObject({ op: 'page', collection: 'stamps' });
  });
});
