import { describe, it, expect } from 'vitest';
import type { ForgeDraft } from '@chatdom/shared';
import { forgeDeliveryMessage, FORGE_WAIT_MESSAGES, type ForgeRunSelection } from './wish-decision';

const draft: ForgeDraft = { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'INJECTED MODEL TITLE', plaque: 'INJECTED MODEL PLAQUE' };
const selection: ForgeRunSelection = { delivery: 'softened', reason: 'vocabulary', shared: 'family', verdict: 1, attempt: 1 };
describe('private Forge messages', () => {
 it('names the actual piece and connection without repeating model prose', () => {
  const message = forgeDeliveryMessage(draft, selection);
  expect(message).toContain('chimney with a sleeping dragon');
  expect(message).toContain('closest');
  expect(message).toContain('family');
  expect(message).not.toContain('INJECTED');
 });
 it('explains delivered and different softened causes in finite words', () => {
  expect(forgeDeliveryMessage(draft)).toContain('One coal');
  expect(forgeDeliveryMessage(draft, { ...selection, reason: 'fit', shared: 'slot' })).toContain('fit your home');
  const unclear = forgeDeliveryMessage(draft, { ...selection, reason: 'quality', shared: 'subject' });
  expect(unclear).toContain('could not make an exact match');
  expect(unclear).not.toContain('keeps your chosen subject');
  expect(unclear).not.toContain('small detail');
  expect(FORGE_WAIT_MESSAGES.noSlot).toContain('no clear place');
  expect(FORGE_WAIT_MESSAGES.service).toContain('helpers');
  expect(FORGE_WAIT_MESSAGES.budget).toContain('more time');
 });
});
