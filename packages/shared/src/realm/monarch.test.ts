import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../identity';
import { DEFAULT_MONARCH_TITLE, MonarchChannelRequestSchema, arrivalLine, isVerifiedMonarch, monarchCrownOf, monarchNameTag, monarchTitleOf } from './monarch';
import { RealmObservedWalkerSchema } from './watch';

const kingdomId = KingdomIdSchema.parse('129634568');
const who = (personId: string, origin: 'live' | 'simulated' = 'live') => ({ personId: PersonIdSchema.parse(personId), kingdomId, origin });

describe('who counts as monarch', () => {
  it('is the verified broadcaster only: a live sign-in whose person is the kingdom’s own channel', () => {
    expect(isVerifiedMonarch(who('129634568'))).toBe(true);
    expect(isVerifiedMonarch(who('129634569'))).toBe(false);
    // A staged or bench sign-in never crowns anyone, even with the channel's id.
    expect(isVerifiedMonarch(who('129634568', 'simulated'))).toBe(false);
  });
  it('ignores names: a citizen called like the streamer is not the monarch', () => {
    expect(isVerifiedMonarch({ ...who('42'), publicName: 'tobi4s_' } as never)).toBe(false);
  });
});

describe('the title rule', () => {
  it('defaults to Monarch, and is King or Queen only when the streamer chose it', () => {
    expect(DEFAULT_MONARCH_TITLE).toBe('Monarch');
    expect(monarchTitleOf(undefined)).toBe('Monarch');
    expect(monarchTitleOf('King')).toBe('King');
    expect(monarchTitleOf('Queen')).toBe('Queen');
    for (const guess of ['king', 'Emperor', '', null, 7]) expect(monarchTitleOf(guess)).toBe('Monarch');
    expect(MonarchChannelRequestSchema.safeParse({ version: 1, type: 'title', title: 'Empress' }).success).toBe(false);
  });
  it('reads a crown mark strictly and names the title on the tag', () => {
    expect(monarchCrownOf('')).toBeNull();
    expect(monarchCrownOf('Queen')).toBe('Queen');
    expect(monarchCrownOf('queen')).toBeNull();
    expect(monarchNameTag('Monarch', 'tobi4s_')).toBe('Monarch tobi4s_');
    expect(monarchNameTag('Queen', ' Hazel ')).toBe('Queen Hazel');
    expect(monarchNameTag('King', '')).toBe('King');
  });
  it('carries the crown in the public walker frame only as one of the three words', () => {
    const walker = { id: 'w1', name: 'tobi4s_', look: 'hearth', homeSlot: 65534, x: 0, y: 0, z: 0, yaw: 0, distance: 0, speed: 0, placement: 0 };
    expect(RealmObservedWalkerSchema.safeParse({ ...walker, crown: 'Monarch' }).success).toBe(true);
    expect(RealmObservedWalkerSchema.safeParse(walker).success).toBe(true);
    expect(RealmObservedWalkerSchema.safeParse({ ...walker, crown: 'Tyrant' }).success).toBe(false);
  });
});

describe('the first-arrival line', () => {
  it('tells a citizen they are home and a guest they are visiting, naming the monarch', () => {
    expect(arrivalLine({ kingdom: 'Willowmere', monarch: 'tobi4s_', standing: 'citizen' })).toEqual({ place: 'Willowmere, the kingdom of tobi4s_', standing: 'this is your home' });
    expect(arrivalLine({ kingdom: 'Willowmere', monarch: 'tobi4s_', standing: 'guest' })).toEqual({ place: 'Willowmere, the kingdom of tobi4s_', standing: 'you are visiting' });
  });
  it('welcomes the monarch home and never invents a name it does not have', () => {
    expect(arrivalLine({ kingdom: 'Willowmere', monarch: 'tobi4s_', standing: 'monarch' })).toEqual({ place: 'Willowmere, your kingdom', standing: 'welcome home' });
    expect(arrivalLine({ kingdom: 'Willowmere', monarch: null, standing: 'guest' }).place).toBe('Willowmere');
    expect(arrivalLine({ kingdom: 'Willowmere', monarch: '  ', standing: 'citizen' }).place).toBe('Willowmere');
  });
});
