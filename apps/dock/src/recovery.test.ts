import { describe, expect, it } from 'vitest';
import { bindRecovery, chooseKingdom, clearRecovery, migrateLegacy, readRecovery, sameScope, writeRecovery } from './recovery';

function storage(): Storage {
  const entries = new Map<string, string>();
  return { get length() { return entries.size; }, clear: () => entries.clear(), getItem: key => entries.get(key) ?? null,
    key: index => [...entries.keys()][index] ?? null, removeItem: key => { entries.delete(key); },
    setItem: (key, value) => { entries.set(key, value); } };
}
const session = 'session-scope-0123456789';
describe('dock recovery', () => {
  it('retains uncertain acts and receipts on reload, isolated by kingdom', () => {
    const memory = storage();
    expect(bindRecovery(memory, session)).toBe(true);
    expect(writeRecovery(memory, session, '12', { uncertain: 'action-1', receipt: 'receipt-1' })).toBe(true);
    expect(bindRecovery(memory, session)).toBe(true);
    expect(readRecovery(memory, session, '12')).toEqual({ uncertain: 'action-1', receipt: 'receipt-1' });
    expect(readRecovery(memory, session, '13')).toEqual({ uncertain: '', receipt: '' });
  });
  it('discards prior identity records when a session is replaced or ended', () => {
    const memory = storage(); bindRecovery(memory, session);
    writeRecovery(memory, session, '12', { uncertain: 'action-1', receipt: 'receipt-1' });
    bindRecovery(memory, 'a-different-session-scope');
    expect(readRecovery(memory, session, '12').receipt).toBe('');
    expect(readRecovery(memory, 'a-different-session-scope', '12').uncertain).toBe('');
    clearRecovery(memory);
    expect(writeRecovery(memory, session, '12', { uncertain: 'action-2', receipt: '' })).toBe(false);
  });
  it('carries a prior unscoped unknown action into the first authenticated kingdom', () => {
    const memory = storage(); memory.setItem('chatdom-dock-uncertain', 'old-action'); bindRecovery(memory, session);
    expect(migrateLegacy(memory, session, '12')).toBe(true);
    expect(readRecovery(memory, session, '12').uncertain).toBe('old-action');
    expect(memory.getItem('chatdom-dock-uncertain')).toBeNull();
  });
  it('refuses unpersistable intent instead of pretending recovery is available', () => {
    const memory = storage(); bindRecovery(memory, session);
    memory.setItem = () => { throw new Error('storage disabled'); };
    expect(writeRecovery(memory, session, '12', { uncertain: 'action-1', receipt: '' })).toBe(false);
    expect(writeRecovery(storage(), session, 'not-a-kingdom', { uncertain: '', receipt: '' })).toBe(false);
  });
  it('preserves realm receipt tokens containing colons and dots', () => {
    const memory = storage(); bindRecovery(memory, session);
    expect(writeRecovery(memory, session, '12', { uncertain: '', receipt: 'dock:receipt.1' })).toBe(true);
    bindRecovery(memory, session);
    expect(readRecovery(memory, session, '12').receipt).toBe('dock:receipt.1');
  });
  it('restores the witnessed receipt format emitted by the realm after a reload', () => {
    const memory = storage();
    const receipt = `receipt:dock:${'a'.repeat(48)}`;
    bindRecovery(memory, session);
    expect(writeRecovery(memory, session, '12', { uncertain: '', receipt })).toBe(true);
    expect(readRecovery(memory, session, '12').receipt).toBe(receipt);
  });
  it('opens the requested kingdom even when browser storage is blocked', () => {
    const memory = storage();
    memory.setItem = () => { throw new Error('blocked'); };
    memory.getItem = () => { throw new Error('blocked'); };
    expect(chooseKingdom(memory, '42')).toBe('42');
    expect(chooseKingdom(memory, null)).toBeNull();
  });
  it('does not apply a reply to a different or ended identity', () => {
    expect(sameScope({ status: 'authenticated', resumeScope: session }, session)).toBe(true);
    expect(sameScope({ status: 'authenticated', resumeScope: 'other-session' }, session)).toBe(false);
    expect(sameScope({ status: 'anonymous' }, session)).toBe(false);
  });

});
