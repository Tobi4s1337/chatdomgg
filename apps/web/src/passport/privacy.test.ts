import { describe, expect, it } from 'vitest';
// The craft entry has no JSX or CSS, so Vitest can read it without the Solid compiler.
import {
  acknowledgesDisclosure, createPassportSession, followDisclosure, type PassportReadState, type PassportTransport,
} from '../../../../packages/ui/src/passport/craft';
import { projectCard } from '../../../api/src/citizen-card/project';
import { disclosedPlaces, passportDisclosure } from '../../../api/src/passport/disclosure';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { pictureOf } from './picture';
import { passportLocalTransport } from './transport';

const settle = async (read: () => PassportReadState, until: (state: PassportReadState) => boolean) => {
  for (let i = 0; i < 50 && !until(read()); i++) await new Promise(resolve => setTimeout(resolve, 0));
  return read();
};

/** The card page as main binds it: one SIMULATED citizen, the real reader, a serialised wire, the card's disclosure. */
function cardPage() {
  const sim = simulatedPassportAuthorities('many', { signedIn: true, travelsHidden: false });
  const sent: string[] = [];
  const local = passportLocalTransport(createPassportReader(sim.ports), { key: sim.key, now: sim.now });
  const transport: PassportTransport = (request, signal) => { sent.push(request.op); return local(request, signal); };
  const session = createPassportSession(transport);
  const follow = followDisclosure(session);
  const card = () => projectCard(sim.card());
  return { sim, session, follow, card, sent };
}

describe('the card page keeps the holder’s privacy through a change', () => {
  it('an acknowledged hide closes the book with nothing left of it, and the homes stay on the card', async () => {
    const page = cardPage();
    const before = page.card();
    page.follow(passportDisclosure(before));
    expect((await settle(page.session.state, state => state.kind !== 'pending')).kind).toBe('visible');

    // The holder hides their travels; the authority answers the card projected again.
    const answer = passportDisclosure(projectCard(page.sim.setTravelsHidden(true)));
    expect(acknowledgesDisclosure(passportDisclosure(before), 'hidden', answer)).toBe(true);
    page.sent.length = 0;
    page.follow(answer);
    expect(page.session.state()).toEqual({ kind: 'hidden', origin: 'simulated' });
    expect(page.sent).toEqual([]);
    // The card keeps every home it showed, so the places a road may name are unchanged.
    const after = page.card();
    expect(after.homes).toEqual(before.homes);
    expect([...disclosedPlaces(after)]).toEqual([...disclosedPlaces(before)]);
    // And the server agrees: a read now answers the hidden variant whatever the page did.
    page.session.open();
    expect(await settle(page.session.state, state => state.kind !== 'pending')).toEqual({ kind: 'hidden', origin: 'simulated' });
  });

  it('shown again is a fresh read, and a stale card from before the hide never reopens the book', async () => {
    const page = cardPage();
    const first = passportDisclosure(page.card());
    page.follow(first);
    await settle(page.session.state, state => state.kind !== 'pending');
    page.follow(passportDisclosure(projectCard(page.sim.setTravelsHidden(true))));
    page.sent.length = 0;
    page.follow(first);
    expect(page.sent).toEqual([]);
    expect(page.session.state().kind).toBe('hidden');
    page.follow(passportDisclosure(projectCard(page.sim.setTravelsHidden(false))));
    expect(page.sent).toEqual(['book']);
    expect((await settle(page.session.state, state => state.kind !== 'pending')).kind).toBe('visible');
  });
});

describe('the print of a shared spread', () => {
  it('asks for its own picture for every snapshot shown, keeping the route and its fragment', () => {
    const a = pictureOf('/-/citizens/910000101/930000001/passport.png', { revision: 'p1.1.1.1.1' });
    const b = pictureOf('/-/citizens/910000101/930000001/passport.png', { revision: 'p1.1.1.1.1' });
    expect(a).toMatch(/^\/-\/citizens\/910000101\/930000001\/passport\.png\?snapshot=p1\.1\.1\.1\.1\.\d+$/);
    expect(a).not.toBe(b);
    expect(pictureOf('/-/passport/share.png?fixture=few#print', { revision: 'p1.2.1.1.1' })).toMatch(/^\/-\/passport\/share\.png\?fixture=few&snapshot=p1\.2\.1\.1\.1\.\d+#print$/);
  });
});
