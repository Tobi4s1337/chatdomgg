import { expect, it } from 'vitest';
import { createCandidateLifetime } from './candidate';
it('transfers promoted engine lifetime from a seek to its overlay, while cancelling unfinished preparation', () => {
  const owner = new AbortController(), oldSeek = new AbortController();
  const promoted = createCandidateLifetime(oldSeek.signal, owner.signal);
  promoted.promote(); oldSeek.abort();
  expect(promoted.signal.aborted).toBe(false);
  const newSeek = new AbortController(), pending = createCandidateLifetime(newSeek.signal, owner.signal);
  newSeek.abort(); expect(pending.signal.aborted).toBe(true);
  expect(promoted.signal.aborted).toBe(false);
  owner.abort(); expect(promoted.signal.aborted).toBe(true);
  promoted.dispose(); pending.dispose();
});
