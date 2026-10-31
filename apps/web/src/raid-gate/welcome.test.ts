import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import type { GateCommand, GateReply, VisitorGiftView, WelcomeView } from '../../../api/src/raid-gate/contracts';
import { createGuestWelcomeController, type WelcomeSnapshot } from './welcome';

const FERN = KingdomIdSchema.parse('41000002');
const HOME = KingdomIdSchema.parse('41000001');
const WREN = PersonIdSchema.parse('42000001');
const HAZEL = PersonIdSchema.parse('41000002');
const NOW = Date.UTC(2026, 9, 31, 18);

const offer = (state: VisitorGiftView['state'], revision: number): VisitorGiftView => ({
  offerId: 'offer-1', itemId: 'loaf', from: HAZEL, to: WREN, originKingdomId: FERN, makerId: HAZEL, revision, state,
  kingdomId: FERN, direction: 'brought-back', story: { title: 'Fern-sprig welcome loaf', kind: 'welcome-offering', makerName: 'Queen Hazel', originName: 'Fernhollow' },
  fromName: 'Queen Hazel', toName: 'Wren', expiresAt: NOW + 600_000,
  receipt: state === 'accepted' ? { transferId: 'offer-1', at: NOW + 1 } : null,
});

/** A SIMULATED gatekeeper whose first answer to an accept is lost after it committed. */
function gatekeeper() {
  let current = offer('offered', 1);
  const accepts: string[] = [];
  let lose = true;
  const welcome = (): WelcomeView => ({
    kingdomId: FERN, viewer: 'visitor', arrival: { arrivalId: 'arrival.1', from: HOME, arrivedAt: NOW, present: true, raidId: 'raid-1' },
    party: 3, monarch: { personId: HAZEL, name: 'Queen Hazel' }, guests: [], offers: [current], shelf: [],
  });
  const api = {
    origin: 'simulated' as const,
    async request(command: GateCommand): Promise<GateReply> {
      if (command.op === 'welcome') return { kind: 'welcome', value: welcome() };
      if (command.op === 'accept-gift') {
        accepts.push(command.requestId);
        if (current.state === 'offered') current = offer('accepted', 2);
        if (lose) { lose = false; throw new Error('SIMULATED: the answer was lost'); }
        return { kind: 'gift', value: current };
      }
      throw new Error(`unexpected ${command.op}`);
    },
  };
  return { api: api as never, accepts, current: () => current };
}

describe('the welcome in the browser', () => {
  it('asks again under the same request when an accept answer is lost, and shows it as checked, never as taken twice', async () => {
    const keeper = gatekeeper();
    const seen: WelcomeSnapshot[] = [];
    let id = 0;
    const welcome = createGuestWelcomeController({ api: keeper.api, clock: () => NOW, ids: () => `press-${++id}`, wait: async () => {}, pollMs: 0 }, 'arrival.1');
    welcome.subscribe(snapshot => seen.push(snapshot));
    await welcome.refresh();
    expect(welcome.snapshot().view?.offers[0]?.state).toBe('offered');

    await welcome.accept('offer-1');
    await welcome.refresh();

    expect(keeper.accepts).toEqual(['press-1', 'press-1']);
    expect(seen.some(snapshot => snapshot.checking.includes('offer-1') && snapshot.view?.offers[0]?.state === 'offered')).toBe(true);
    const after = welcome.snapshot();
    expect(after.checking).toEqual([]);
    expect(after.notice).toBeNull();
    expect(after.view?.offers).toHaveLength(1);
    expect(after.view?.offers[0]).toMatchObject({ state: 'accepted', receipt: { transferId: 'offer-1' } });
    expect(after.origin).toBe('simulated');
    welcome.dispose();
  });
});
