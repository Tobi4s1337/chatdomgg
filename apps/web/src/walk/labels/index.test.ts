import { expect, it } from 'vitest';
import { joinSpeech, labelContentKey, labelMeasureKey, peopleFromLabels, type PersonLabel } from './model';
import type { SpeechFrame } from './bus';

it('keeps a measurement across a name toggle, never across different words or a different kind of label', () => {
  const person: PersonLabel = { id: 'a', x: 10, y: 20, distance: 5, self: false, name: 'Ash' };
  const speech: PersonLabel = { ...person, speech: [{ kind: 'text', text: 'Hello' }] };
  expect(labelMeasureKey(person)).not.toBe(labelMeasureKey(speech));
  expect(labelMeasureKey(speech)).not.toBe(labelMeasureKey({ ...speech, speech: [{ kind: 'text', text: 'Changed' }] }));
  expect(labelMeasureKey(person)).toBe(labelMeasureKey({ ...person, x: 50, y: 70, opacity: .5 }));
  // The home's own plate takes the name over: the bubble keeps its size and is not re-laid out from nothing.
  expect(labelMeasureKey({ ...speech, name: null })).toBe(labelMeasureKey(speech));
  // The content key still sees the change, so the element is re-measured in the same frame.
  expect(labelContentKey({ ...speech, name: null })).not.toBe(labelContentKey(speech));
});

it('joins only an authoritative slot and retains unmatched speech without inventing a name', () => {
  const walkers = [{ id: 'w', slot: 7, name: 'Ash', x: 10, y: 20, distance: 5, self: true },
    { id: 'v', name: 'Other', x: 60, y: 20, distance: 8, self: false }];
  const parts = [{ kind: 'text' as const, text: 'Hi' }];
  expect(peopleFromLabels(walkers, [{ slot: 7, name: null, x: 11, y: 19, distance: 5, parts },
    { slot: 8, name: null, x: 80, y: 20, distance: 6, parts }])).toEqual([
    // A walker who speaks keeps their name plate and gains a bubble of their own at the cue's head.
    { id: 'walker:w', walkerId: 'w', slot: 7, x: 10, y: 20, distance: 5, self: true, name: 'Ash' },
    { id: 'walker:v', walkerId: 'v', x: 60, y: 20, distance: 8, self: false, name: 'Other' },
    { id: 'speech:w', walkerId: 'w', slot: 7, x: 11, y: 19, distance: 5, self: true, name: 'Ash', speech: parts },
    { id: 'slot:8', slot: 8, x: 80, y: 20, distance: 6, self: false, name: null, speech: parts },
  ]);
  expect(peopleFromLabels(walkers, []).map(person => person.id)).toEqual(['walker:w', 'walker:v']);
});

it('puts a walker’s line in a bubble on that walker’s own head, beside their name, and a chat-only line over their home', () => {
  const parts = [{ kind: 'text' as const, text: 'Evening!' }];
  const people = peopleFromLabels([{ id: 'w', slot: 3, name: 'Wren', x: 300, y: 200, distance: 6, self: false }], []);
  const frame: SpeechFrame = { at: 0, width: 800, height: 600, speech: [
    { slot: 3, cueId: 'a', from: 'walker', name: null, parts },
    { slot: 9, cueId: 'b', from: 'home', name: 'Rowan', parts, x: 500, y: 150, distance: 12, visibility: 0 },
    // A walker who is hidden this frame has no label: their line is not drawn anywhere else.
    { slot: 4, cueId: 'c', from: 'walker', name: 'Hidden', parts },
  ] };
  expect(joinSpeech(people, frame)).toEqual([
    { id: 'walker:w', walkerId: 'w', slot: 3, x: 300, y: 200, distance: 6, self: false, name: 'Wren' },
    { id: 'speech:w', walkerId: 'w', slot: 3, x: 300, y: 200, distance: 6, self: false, name: 'Wren', speech: parts },
    { id: 'home:9', slot: 9, x: 500, y: 150, distance: 12, self: false, name: 'Rowan', speech: parts, home: true, visibility: 0 },
  ]);
  expect(joinSpeech(people, null)).toEqual(people);
});
