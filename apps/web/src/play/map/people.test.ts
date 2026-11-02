import { describe, expect, it } from 'vitest';
import { mapPeople, type MapWalker } from './people';

const walker = (id: string, x: number, self = false, name = id): MapWalker => ({ id, name, position: [x, 0, x], yaw: .5, self });
const street: MapWalker[] = [walker('me', 1, true, 'Juniper'), walker('w1', 2, false, 'Rowan'), walker('w2', 3, false, 'Wren'), walker('w3', 4, false, 'Juniper')];

describe('the map shows you and your friends, never strangers', () => {
  it('shows only you while no friend authority exists', () => {
    const people = mapPeople(street, null);
    expect(people.you).toEqual({ x: 1, z: 1, heading: .5 });
    expect(people.friends).toEqual([]);
  });

  it('shows a walker only when the authority names them as a mutual friend', () => {
    const people = mapPeople(street, { mutual: () => new Set(['w2']) });
    expect(people.friends.map(friend => friend.id)).toEqual(['w2']);
    expect(people.friends[0]).toEqual({ id: 'w2', name: 'Wren', x: 3, z: 3 });
  });

  it('never takes a stranger for a friend by their name, even your own name', () => {
    // w3 is called Juniper, as you are: a name is never an identity.
    const people = mapPeople(street, { mutual: walkers => new Set(walkers.filter(w => w.name === 'Rowan').map(w => w.id)) });
    expect(people.friends.map(friend => friend.id)).toEqual(['w1']);
  });

  it('ignores ids the authority invents for people not in the street, and never lists you as your own friend', () => {
    const people = mapPeople(street, { mutual: () => new Set(['me', 'ghost', 'w1']) });
    expect(people.friends.map(friend => friend.id)).toEqual(['w1']);
  });

  it('shows no one but you when the authority fails or answers wrongly', () => {
    expect(mapPeople(street, { mutual: () => { throw new Error('down'); } }).friends).toEqual([]);
    expect(mapPeople(street, { mutual: () => ['w1', 'w2'] as unknown as ReadonlySet<string> }).friends).toEqual([]);
  });

  it('asks the authority only about the others, by id and name, never their positions', () => {
    let asked: unknown;
    mapPeople(street, { mutual: walkers => { asked = walkers; return new Set(); } });
    expect(asked).toEqual([{ id: 'w1', name: 'Rowan' }, { id: 'w2', name: 'Wren' }, { id: 'w3', name: 'Juniper' }]);
  });

  it('has no one at all before the room has placed you', () => {
    expect(mapPeople([walker('w1', 2)], null)).toEqual({ you: null, friends: [] });
  });
});
