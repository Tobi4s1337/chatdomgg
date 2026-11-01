import { expect, it } from 'vitest';
import { labelMeasureKey, peopleFromLabels, type PersonLabel } from './model';

it('does not reuse a name or removed bubble measurement for different witnessed content', () => {
  const person: PersonLabel = { id: 'a', x: 10, y: 20, distance: 5, self: false, name: 'Ash' };
  const speech: PersonLabel = { ...person, speech: [{ kind: 'text', text: 'Hello' }] };
  expect(labelMeasureKey(person)).not.toBe(labelMeasureKey(speech));
  expect(labelMeasureKey(speech)).not.toBe(labelMeasureKey({ ...speech, speech: [{ kind: 'text', text: 'Changed' }] }));
  expect(labelMeasureKey(person)).toBe(labelMeasureKey({ ...person, x: 50, y: 70, opacity: .5 }));
});

it('joins only an authoritative slot and retains unmatched speech without inventing a name', () => {
  const walkers = [{ id: 'w', slot: 7, name: 'Ash', x: 10, y: 20, distance: 5, self: true },
    { id: 'v', name: 'Other', x: 60, y: 20, distance: 8, self: false }];
  const parts = [{ kind: 'text' as const, text: 'Hi' }];
  expect(peopleFromLabels(walkers, [{ slot: 7, name: null, x: 11, y: 19, distance: 5, parts },
    { slot: 8, name: null, x: 80, y: 20, distance: 6, parts }])).toEqual([
    { id: 'walker:w', walkerId: 'w', slot: 7, x: 11, y: 19, distance: 5, self: true, name: 'Ash', speech: parts },
    { id: 'slot:8', slot: 8, x: 80, y: 20, distance: 6, self: false, name: null, speech: parts },
    { id: 'walker:v', walkerId: 'v', x: 60, y: 20, distance: 8, self: false, name: 'Other' },
  ]);
  expect(peopleFromLabels(walkers, []).map(person => person.id)).toEqual(['walker:w', 'walker:v']);
});
