import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src';
import type { Capability } from '../../../web/src/twitch-moments/contracts';
import { createKingdomMomentApplication, createKingdomMomentHandler } from './gameplay';
import type { KingdomMomentCommand, Principal, RealmGameplayPort, RealmGameplayReply } from './ports';

const K = KingdomIdSchema.parse('424242'), OTHER = KingdomIdSchema.parse('515151');
const walker: Principal = { personId: PersonIdSchema.parse('81000006'), kingdomId: K, role: 'walker', sessionKey: 'session-1' };
const READY: Capability = { available: true, reason: 'ready', retryAt: null };
const signal = new AbortController().signal;

describe('free strike, haul and fireworks chant: the realm decides', () => {
  it('delegates once per intent, preserves the verdict and never invents acceptance', async () => {
    let now = Date.UTC(2026, 9, 31, 20, 0);
    const clock = { now: () => now };
    const sent: KingdomMomentCommand[] = [];
    let verdict: (command: KingdomMomentCommand) => Promise<RealmGameplayReply> = async command =>
      ({ status: 'accepted', receiptKey: `r.${command.intentId}`, acceptedAt: now });
    const gameplay: RealmGameplayPort = {
      submit: command => { sent.push(command); return verdict(command); },
      capabilities: async () => new Map([['strike', READY], ['haul', READY], ['fireworks-chant', { available: false, reason: 'ineligible', retryAt: null }]]),
    };
    const app = createKingdomMomentApplication({ gameplay, clock });
    const strike = (id: string) => ({ id, type: 'kingdom.moment', args: { kind: 'strike', battleKey: 'dragon-1' } });
    const here = { principal: walker, kingdomId: K };

    // Two in-flight copies of one intent are one dispatch and one result; the person comes from the principal.
    const [a, b] = await Promise.all([app.submit(here, strike('i-1'), signal), app.submit(here, strike('i-1'), signal)]);
    expect(a).toEqual({ status: 'accepted', intentId: 'i-1', receiptKey: 'r.i-1', acceptedAt: now, providerId: null });
    expect(b).toBe(a);
    expect(sent).toEqual([{ kingdomId: K, personId: walker.personId, intentId: 'i-1', args: { kind: 'strike', battleKey: 'dragon-1' } }]);
    // The cadence pre-check spaces one person's strikes; capabilities narrow with it and never widen the realm's.
    expect(await app.submit(here, strike('i-2'), signal)).toEqual({ status: 'rejected', intentId: 'i-2', reason: 'rate-limit', retryAt: now + 800 });
    expect((await app.capabilities(here)).get('strike')).toEqual({ available: false, reason: 'rate-limit', retryAt: now + 800 });
    expect((await app.capabilities(here)).get('fireworks-chant')).toEqual({ available: false, reason: 'ineligible', retryAt: null });
    now += 800;
    // A realm refusal is a rejection with its own reason; a haul then waits for the realm's retry time.
    verdict = async () => ({ status: 'refused', reason: 'rate-limit', retryAt: now + 30_000 });
    expect(await app.submit(here, { id: 'i-3', type: 'kingdom.moment', args: { kind: 'haul' } }, signal))
      .toEqual({ status: 'rejected', intentId: 'i-3', reason: 'rate-limit', retryAt: now + 30_000 });
    expect(await app.submit(here, { id: 'i-4', type: 'kingdom.moment', args: { kind: 'haul' } }, signal)).toMatchObject({ status: 'rejected', retryAt: now + 30_000 });
    expect(sent).toHaveLength(2);
    // A throw after dispatch is unknown, never acceptance; an unreadable reply too.
    verdict = async () => { throw new Error('socket hang up'); };
    expect(await app.submit(here, strike('i-5'), signal)).toEqual({ status: 'unknown', intentId: 'i-5', reconciliationKey: 'i-5' });
    now += 800;
    verdict = async () => ({ status: 'accepted' }) as unknown as RealmGameplayReply;
    expect(await app.submit(here, strike('i-6'), signal)).toMatchObject({ status: 'unknown' });
    // Another kingdom, invalid args and no intent ID are refused before the realm hears anything.
    const dispatched = sent.length;
    expect(await app.submit({ principal: walker, kingdomId: OTHER }, strike('i-7'), signal)).toEqual({ status: 'rejected', intentId: 'i-7', reason: 'permission', retryAt: null });
    expect(await app.submit(here, { id: 'i-8', type: 'kingdom.moment', args: { kind: 'strike' } }, signal)).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(await app.submit(here, { type: 'kingdom.moment', args: { kind: 'haul' } }, signal)).toEqual({ status: 'malformed' });
    expect(sent).toHaveLength(dispatched);

    // Without a realm every capability and submit is unavailable.
    const none = createKingdomMomentApplication({ gameplay: null, clock });
    expect([...(await none.capabilities(here)).values()].every(c => !c.available && c.reason === 'unavailable')).toBe(true);
    expect(await none.submit(here, strike('i-9'), signal)).toEqual({ status: 'unavailable', intentId: 'i-9' });

    // Over HTTP: the principal comes only from principalFor, the kingdom parameter is checked against it.
    let session = true;
    const handle = createKingdomMomentHandler(app, { principalFor: async () => (session ? { ok: true, principal: walker } : { ok: false, reason: 'unauthenticated' }) });
    const post = (body: string, kingdom: string = K) => handle(new Request(`https://chatdom.test/moments/submit?kingdom=${kingdom}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    now += 800;
    verdict = async command => ({ status: 'accepted', receiptKey: `r.${command.intentId}`, acceptedAt: now });
    const ok = await post(JSON.stringify({ ...strike('h-1'), personId: '1' }));
    expect([ok.status, await ok.json()]).toEqual([400, { status: 'rejected', intentId: 'h-1', reason: 'invalid', retryAt: null }]);
    const accepted = await post(JSON.stringify(strike('h-2')));
    expect([accepted.status, (await accepted.json() as { status: string }).status]).toEqual([200, 'accepted']);
    expect((await post(JSON.stringify(strike('h-3')), OTHER)).status).toBe(403);
    expect((await post('x'.repeat(5000))).status).toBe(413);
    expect((await handle(new Request(`https://chatdom.test/moments/capabilities?kingdom=${K}`))).status).toBe(200);
    expect((await createKingdomMomentHandler(none, { principalFor: async () => ({ ok: true, principal: walker }) })(
      new Request(`https://chatdom.test/moments/submit?kingdom=${K}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strike('h-4')) }))).status)
      .toBe(503);
    session = false;
    expect((await post(JSON.stringify(strike('h-5')))).status).toBe(401);
  });
});
