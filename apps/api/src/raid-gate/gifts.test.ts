/**
 * Visitor gift guards (spec 23 R9, RG10). Each case protects one invariant the integration run does not: only things
 * that may be given are offered, only a visitor and a host of the visited kingdom give to each other, a failed commit
 * loses nothing and a retry moves the thing once, and a thing that changed hands after its offer never moves. The
 * item store, the arrival and the host directory are SIMULATED.
 */
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';
import { createArrivalWitness } from '../../../realm/src/raid-gate/arrivals';
import { createMemoryTravelRepository } from '../../../realm/src/raid-gate/memory-repository';
import type { TravelRole } from '../../../realm/src/raid-gate/records';
import { GATE_LIMITS, readGateReply, type GateContext, type GateReply } from './contracts';
import { createMemoryItemTransfers } from './gift-memory';
import { BOUND_KINDS, createVisitorGifts, type GiftCommand, type GiftHosts, type GiftItem, type ItemKind } from './gifts';

const HOME = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const WREN = PersonIdSchema.parse('52000001');
const OAK = PersonIdSchema.parse('52000002');
const ASH = PersonIdSchema.parse('53000001');
/** Signed in to Mira, with no deed there. */
const STRANGER = PersonIdSchema.parse('54000001');
const T0 = 1_800_000_000_000;

const hosts: GiftHosts = {
  origin: 'simulated',
  async standing(personId, kingdomId) { return String(personId) === String(kingdomId) ? 'monarch' : personId === ASH && kingdomId === MIRA ? 'citizen' : 'none'; },
  async names() { return new Map(); },
};

const thing = (itemId: string, ownerId: PersonId, kind: ItemKind = 'crafted', extra: Partial<GiftItem> = {}): GiftItem => ({
  itemId, revision: 1, ownerId, kind, title: `A ${kind} thing`, makerId: ownerId, makerName: null, originKingdomId: HOME, originName: null,
  transferable: true, paid: false, origin: 'simulated', ...extra,
});

async function setup(options: { role?: TravelRole; present?: boolean } = {}) {
  let now = T0;
  const journeys = createMemoryTravelRepository();
  // A SIMULATED acknowledged arrival: Wren from Home, standing in Mira as a visitor (or already gone home).
  await journeys.transaction(async tx => {
    await tx.putArrival({
      arrivalId: 'arrival.t1', revision: 1, personId: WREN, ticket: 't1', from: HOME, to: MIRA, role: options.role ?? 'visitor',
      reason: { kind: 'raid', requestId: 'r1', raidId: 'raid-1' }, generation: 1, committedAt: T0, origin: 'simulated',
    }, 0);
    await tx.putWhereabouts({
      personId: WREN, revision: 1, kingdomId: options.present === false ? HOME : MIRA, generation: options.present === false ? 2 : 1,
      arrivalId: options.present === false ? 'arrival.t0' : 'arrival.t1', active: null, fence: null, updatedAt: T0,
    }, 0);
  }, new AbortController().signal);
  const items = createMemoryItemTransfers('simulated');
  let offered = 0;
  const gifts = createVisitorGifts({ items, arrivals: createArrivalWitness({ repository: journeys, origin: 'simulated' }), hosts, origin: 'simulated', ids: () => `offer${++offered}` });
  const as = (personId: PersonId, kingdomId: KingdomId) => async (command: GiftCommand): Promise<GateReply> => {
    const context: GateContext = {
      principal: { personId, sessionId: `s-${personId}`, sourceKingdomId: kingdomId, sourceRole: String(personId) === String(kingdomId) ? 'monarch' : personId === ASH ? 'citizen' : 'guest' },
      now, signal: new AbortController().signal,
    };
    const reply = await gifts.handle(context, command);
    expect(readGateReply(structuredClone(reply))).toEqual(reply);
    return reply;
  };
  return { items, advance(ms: number) { now += ms; }, wren: as(WREN, HOME), ash: as(ASH, MIRA), queen: as(MIRA as unknown as PersonId, MIRA), stranger: as(STRANGER, MIRA), oak: as(OAK, HOME) };
}

const offerTo = (requestId: string, itemId: string, recipient: PersonId) => ({ op: 'offer-gift', requestId, itemId, recipient, arrivalId: 'arrival.t1' }) as const;
const accept = (offerId: string) => ({ op: 'accept-gift', requestId: `accept-${offerId}`, offerId }) as const;

describe('Visitor gifts (SIMULATED item store)', () => {
  it('offers only things that may be given', async () => {
    const w = await setup();
    w.items.seed([
      ...BOUND_KINDS.map(kind => thing(`bound-${kind}`, ASH, kind)),
      thing('paid', ASH, 'crafted', { paid: true }),
      thing('held', ASH, 'forged', { transferable: false }),
    ]);
    for (const kind of BOUND_KINDS) expect(await w.ash(offerTo(`g-${kind}`, `bound-${kind}`, WREN))).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.ash(offerTo('g-paid', 'paid', WREN))).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.ash(offerTo('g-held', 'held', WREN))).toEqual({ kind: 'denied', code: 'unauthorized' });
    // Ash's shelf in the welcome shows none of them, and nothing was written.
    expect(await w.ash({ op: 'welcome', arrivalId: null })).toMatchObject({ value: { shelf: [] } });
    expect(w.items.snapshot().offers).toEqual([]);
  });

  it('lets only a visitor and a host of the visited kingdom give to each other, while the visitor is there', async () => {
    const w = await setup();
    w.items.seed([thing('acorn', WREN), thing('cup', STRANGER), thing('bell', ASH)]);
    // Wren may leave a gift with Mira's monarch or a citizen of Mira, never with a stranger or another traveller.
    expect(await w.wren(offerTo('g1', 'acorn', STRANGER))).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.wren(offerTo('g1', 'acorn', OAK))).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.wren(offerTo('g1', 'acorn', MIRA as unknown as PersonId))).toMatchObject({ value: { state: 'offered', direction: 'left' } });
    // Someone signed in to Mira without a deed is not a host; a host gives only to the visitor of this arrival.
    expect(await w.stranger(offerTo('g2', 'cup', WREN))).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.ash(offerTo('g3', 'bell', OAK))).toEqual({ kind: 'denied', code: 'unauthorized' });
    // The arrival belongs to Wren: nobody else reads it as their welcome.
    expect(await w.oak({ op: 'welcome', arrivalId: 'arrival.t1' })).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.stranger({ op: 'welcome', arrivalId: null })).toEqual({ kind: 'denied', code: 'unauthorized' });

    // Once Wren has gone home, no new gift is offered around that arrival.
    const gone = await setup({ present: false });
    gone.items.seed([thing('bell', ASH)]);
    expect(await gone.ash(offerTo('g4', 'bell', WREN))).toEqual({ kind: 'denied', code: 'stale' });
    // Someone arriving at their own door is home, not a guest.
    const citizen = await setup({ role: 'citizen' });
    citizen.items.seed([thing('bell', ASH)]);
    expect(await citizen.ash(offerTo('g5', 'bell', WREN))).toEqual({ kind: 'denied', code: 'unauthorized' });
  });

  it('keeps one open offer per thing and bounds the offers around one arrival', async () => {
    const w = await setup();
    w.items.seed(Array.from({ length: GATE_LIMITS.giftsOpenPerArrival + 1 }, (_, index) => thing(`gift${index}`, ASH)));
    expect(await w.ash(offerTo('g0', 'gift0', WREN))).toMatchObject({ value: { offerId: 'offer1' } });
    // The same thing offered again under a new key is refused while its offer stands; the same key returns it.
    expect(await w.ash(offerTo('g0b', 'gift0', WREN))).toEqual({ kind: 'denied', code: 'stale' });
    expect(await w.ash(offerTo('g0', 'gift1', WREN))).toEqual({ kind: 'denied', code: 'invalid' });
    for (let index = 1; index < GATE_LIMITS.giftsOpenPerArrival; index++) expect(await w.ash(offerTo(`g${index}`, `gift${index}`, WREN))).toMatchObject({ kind: 'gift' });
    expect(await w.ash(offerTo('gx', `gift${GATE_LIMITS.giftsOpenPerArrival}`, WREN))).toEqual({ kind: 'denied', code: 'full' });
    // An offer past its window is told as expired, and its thing may be offered again.
    w.advance(GATE_LIMITS.giftOfferMs);
    expect(await w.wren(accept('offer1'))).toMatchObject({ value: { state: 'expired', receipt: null } });
    expect(await w.ash(offerTo('g0c', 'gift0', WREN))).toMatchObject({ value: { state: 'offered' } });
    expect(w.items.snapshot().transfers).toEqual([]);
  });

  it('loses nothing when the store fails before committing, and moves the thing once on retry', async () => {
    const w = await setup();
    w.items.seed([thing('acorn', WREN, 'crafted', { makerName: 'Wren', originName: 'Home' })]);
    expect(await w.wren(offerTo('g1', 'acorn', ASH))).toMatchObject({ value: { offerId: 'offer1', state: 'offered' } });
    expect(await w.wren(accept('offer1'))).toEqual({ kind: 'denied', code: 'unauthorized' });
    w.items.failNextCommit();
    await expect(w.ash(accept('offer1'))).rejects.toThrow(/SIMULATED/);
    // Nothing was kept: the acorn is still Wren's and the offer still stands.
    expect(w.items.snapshot()).toMatchObject({ items: [{ itemId: 'acorn', ownerId: WREN, revision: 1 }], offers: [{ state: 'offered' }], transfers: [] });
    const accepted = await w.ash(accept('offer1'));
    expect(accepted).toMatchObject({ value: { state: 'accepted', direction: 'left', story: { title: 'A crafted thing', makerName: 'Wren', originName: 'Home' }, receipt: { transferId: 'offer1' } } });
    expect(await w.ash(accept('offer1'))).toEqual(accepted);
    expect(await w.ash({ op: 'refuse-gift', requestId: 'late', offerId: 'offer1' })).toEqual(accepted);
    expect(w.items.snapshot()).toMatchObject({ items: [{ ownerId: ASH, revision: 2 }], transfers: [{ from: WREN, to: ASH, fromRevision: 1, toRevision: 2 }] });
  });

  it('never moves a thing that changed hands or changed since it was offered, and a refusal moves nothing', async () => {
    const w = await setup();
    w.items.seed([thing('bell', ASH), thing('cup', ASH)]);
    await w.ash(offerTo('g1', 'bell', WREN));
    await w.ash(offerTo('g2', 'cup', WREN));
    // Outside the gate, the bell changes hands (its authority's own transfer); the offer can no longer be honoured.
    await w.items.transaction(tx => tx.moveItem('bell', ASH, OAK, 1), new AbortController().signal);
    expect(await w.wren(accept('offer1'))).toMatchObject({ value: { state: 'rejected', receipt: null } });
    expect(w.items.snapshot().items.find(item => item.itemId === 'bell')).toMatchObject({ ownerId: OAK, revision: 2 });
    expect(await w.wren({ op: 'refuse-gift', requestId: 'no', offerId: 'offer2' })).toMatchObject({ value: { state: 'refused' } });
    expect(await w.wren(accept('offer2'))).toMatchObject({ value: { state: 'refused' } });
    expect(w.items.snapshot().items.find(item => item.itemId === 'cup')).toMatchObject({ ownerId: ASH, revision: 1 });
    expect(w.items.snapshot().transfers).toEqual([]);
  });
});
