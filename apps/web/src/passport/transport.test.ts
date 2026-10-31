import { describe, expect, it } from 'vitest';
// The craft entry has no JSX or CSS, so Vitest can read it without the Solid compiler.
import { createPassportSession, type PassportReadState } from '../../../../packages/ui/src/passport/craft';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities, type SimulatedScenario } from '../../../api/src/passport/simulated';
import { passportHttpTransport, passportLocalTransport } from './transport';

const settle = async (read: () => PassportReadState, until: (state: PassportReadState) => boolean) => {
  for (let i = 0; i < 50 && !until(read()); i++) await new Promise(resolve => setTimeout(resolve, 0));
  return read();
};

function reading(scenario: SimulatedScenario, wire?: (json: unknown) => unknown) {
  const sim = simulatedPassportAuthorities('many', scenario);
  const session = createPassportSession(passportLocalTransport(createPassportReader(sim.ports), { key: sim.key, now: sim.now }, wire));
  session.open();
  return session;
}

describe('a passport read end to end, across a serialised wire', () => {
  it('opens a visible book and turns its older journeys', async () => {
    const session = reading({ signedIn: true, travelsHidden: false });
    const open = await settle(session.state, state => state.kind !== 'pending');
    expect(open.kind).toBe('visible');
    session.more('stamps');
    const turned = await settle(session.state, state => state.kind === 'visible' && !state.shelf.stamps.pending);
    expect(turned.kind === 'visible' && turned.shelf.stamps.items.length).toBe(90);
  });

  it('reopens the book when a journey lands while reading, and then shows the older journeys of the new snapshot', async () => {
    const session = reading({ signedIn: true, travelsHidden: false, revisedWhileReading: true });
    const first = await settle(session.state, state => state.kind !== 'pending');
    if (first.kind !== 'visible') throw new Error(first.kind);
    session.more('stamps');
    const after = await settle(session.state, state => state.kind === 'visible' && state.book !== first.book && !state.shelf.stamps.pending);
    if (after.kind !== 'visible') throw new Error(after.kind);
    expect(after.book.revision).not.toBe(first.book.revision);
    expect(after.shelf.stamps.items[0]?.id).toBe('arrival:sim-fresh');
    expect(after.shelf.stamps.items).toHaveLength(91);
    expect(after.shelf.stamps.failed).toBeFalsy();
  });

  it('shows hidden before the first sign-in and when travels are hidden', async () => {
    for (const scenario of [{ signedIn: false, travelsHidden: false }, { signedIn: true, travelsHidden: true }]) {
      const session = reading(scenario);
      expect(await settle(session.state, state => state.kind !== 'pending')).toEqual({ kind: 'hidden', origin: 'simulated' });
    }
  });

  it('fails closed as unavailable when the reply is corrupt on the wire', async () => {
    const session = reading({ signedIn: true, travelsHidden: false }, json => ({ ...(json as object), book: { ...(json as { book: object }).book, asOf: 'yesterday' } }));
    expect(await settle(session.state, state => state.kind !== 'pending')).toEqual({ kind: 'unavailable', cause: 'malformed' });
  });

  it('reads main’s route over HTTP: a refused body is malformed, a failed response is a failed read', async () => {
    const respond = (status: number, body: string): typeof fetch => async () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
    const signal = new AbortController().signal;
    expect(await passportHttpTransport('/passport', { fetch: respond(200, '{"kind":"denied","code":"stale"}') })({ op: 'book' }, signal)).toEqual({ kind: 'denied', code: 'stale' });
    expect(await passportHttpTransport('/passport', { fetch: respond(200, '{"kind":"book","book":{"visibility":"visible"}}') })({ op: 'book' }, signal)).toBeUndefined();
    expect(await passportHttpTransport('/passport', { fetch: respond(200, 'not json') })({ op: 'book' }, signal)).toBeUndefined();
    await expect(passportHttpTransport('/passport', { fetch: respond(503, '') })({ op: 'book' }, signal)).rejects.toThrow('503');
  });
});
