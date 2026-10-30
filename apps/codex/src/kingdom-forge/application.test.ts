import { describe, expect, it, vi } from 'vitest';
import { createHome } from '@chatdom/content';
import { KingdomIdSchema, PersonIdSchema, type ForgeDraft } from '@chatdom/shared';
import type { ForgeProviders } from '../providers';
import { createKingdomForgeApplication } from './application';
import type {
  ForgeActivity, ForgeAttachment, ForgeReservation, KingdomForgeAudit, KingdomForgeAuthority, KingdomForgeCommand,
} from './ports';

const now = 2_000_000;
const command: KingdomForgeCommand = {
  kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'), slot: 19,
  messageId: 'private-twitch-message', observedAt: now, words: 'A little dragon asleep on my chimney',
};
const draft: ForgeDraft = {
  plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
  title: 'The sleepy keeper', plaque: 'A quiet watch over a warm hearth.',
};
const pass = { outcome: 'pass' as const, reason: 'passed', records: [{ judge: 'controlled-test-judge', status: 'complete' }] };

/** Controlled authority only for this test. No test authorization implementation is exported to applications. */
function fixture(origin: KingdomForgeAuthority['origin'] = 'live') {
  const home = createHome('house', 'hearth', 0), controller = new AbortController();
  const reservation: ForgeReservation = {
    kingdomId: command.kingdomId, personId: command.personId, slot: 7, home, family: 'hearth',
    reservationId: 'reservation-1', revision: 'home-revision-1', expiresAt: now + 60_000,
    safetyIdentifier: 'stable-hashed-citizen-456',
    attribution: { makerName: 'Rowan', kingdomName: 'Emberwick', approvalId: 'approved-names-1' },
  };
  const publicEvents: ForgeActivity[] = [], audits: KingdomForgeAudit[] = [];
  let coals = 1, current = true;
  let durable: ForgeAttachment | null = null;
  const providers: ForgeProviders = {
    judgeWords: vi.fn(async () => pass), draft: vi.fn(async () => draft), judgeResult: vi.fn(async () => pass),
  };
  const authority: KingdomForgeAuthority = {
    origin,
    reserve: vi.fn(async () => durable ? { kind: 'already-committed' as const } : { kind: 'reserved' as const, reservation }),
    revalidate: vi.fn(async () => ({ kind: 'current' as const, native: reservation })),
    commit: vi.fn(async (input, lease) => {
      expect(lease.current()).toBe(true);
      expect(publicEvents.some(event => event.type === 'committed')).toBe(false);
      expect(audits.at(-1)?.verdicts.map(verdict => verdict.outcome)).toEqual(['pass', 'pass']);
      expect(input.expectedRevision).toBe(reservation.revision);
      expect(input.expectedHomeDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(input.creation.words).toBe(command.words);
      coals--;
      durable = input.attachment;
      return { kind: 'committed' as const, committedAt: now };
    }),
    release: vi.fn(async () => {}),
  };
  const run = createKingdomForgeApplication({
    authority, providers, now: () => now, record: async audit => { audits.push(audit); },
    publish: event => { if (event.type === 'committed') expect(durable).not.toBeNull(); publicEvents.push(event); },
  });
  return { run, authority, providers, publicEvents, audits, reservation, controller,
    lease: { signal: controller.signal, current: () => current },
    invalidate: () => { current = false; }, get coals() { return coals; }, get durable() { return durable; } };
}

describe('the kingdom Forge application', () => {
  it('requires real reservation and both gates, commits once, and keeps failed or stale work away from homes and coals', async () => {
    const missing = fixture();
    const disabled = createKingdomForgeApplication({ providers: missing.providers, record: async () => {}, publish: () => {} });
    expect(await disabled(command, missing.lease)).toEqual({ kind: 'cold' });
    expect(missing.providers.judgeWords).not.toHaveBeenCalled();

    const ineligible = fixture();
    vi.mocked(ineligible.authority.reserve).mockResolvedValue({ kind: 'held' });
    expect(await ineligible.run(command, ineligible.lease)).toEqual({ kind: 'held' });
    expect(ineligible.providers.judgeWords).not.toHaveBeenCalled();
    expect(ineligible.coals).toBe(1);

    const accepted = fixture();
    const result = await accepted.run(command, accepted.lease);
    expect(result).toMatchObject({ kind: 'committed', published: true, attachment: {
      slot: 7, committedAt: now, provenance: { source: 'live', makerName: 'Rowan', firstForgedAt: now },
    } });
    expect(accepted.coals).toBe(0);
    expect(accepted.authority.release).not.toHaveBeenCalled();
    expect(accepted.providers.judgeWords).toHaveBeenCalledWith(expect.objectContaining({ safetyIdentifier: accepted.reservation.safetyIdentifier }));
    expect(accepted.providers.judgeResult).toHaveBeenCalledWith(expect.objectContaining({
      safetyIdentifier: accepted.reservation.safetyIdentifier, contactSheet: expect.stringMatching(/^data:image\/png;base64,/),
    }));
    const publicJson = JSON.stringify(accepted.publicEvents), auditJson = JSON.stringify(accepted.audits);
    for (const privateValue of [command.words, command.messageId, 'personId', accepted.reservation.safetyIdentifier]) {
      expect(publicJson).not.toContain(privateValue);
      expect(auditJson).not.toContain(privateValue);
    }
    expect(await accepted.run(command, accepted.lease)).toEqual({ kind: 'already-committed' });
    expect(accepted.providers.judgeWords).toHaveBeenCalledTimes(1);
    expect(accepted.authority.commit).toHaveBeenCalledTimes(1);
    expect(accepted.publicEvents.filter(event => event.type === 'committed')).toHaveLength(1);

    // The exact same coordinator can rehearse against a simulated room without claiming a live creation.
    const rehearsal = fixture('simulated');
    expect(await rehearsal.run(command, rehearsal.lease)).toMatchObject({ kind: 'committed', attachment: {
      provenance: { source: 'simulated' },
    } });
    expect(rehearsal.durable?.provenance.source).toBe('simulated');
    expect(rehearsal.publicEvents.find(event => event.type === 'committed')).toMatchObject({
      attachment: { provenance: { source: 'simulated' } },
    });
    const unbound = fixture();
    Object.defineProperty(unbound.authority, 'origin', { value: undefined });
    expect(await unbound.run(command, unbound.lease)).toEqual({ kind: 'cold' });
    expect(unbound.authority.reserve).not.toHaveBeenCalled();

    const rejected = fixture();
    vi.mocked(rejected.providers.judgeWords).mockResolvedValue({ ...pass, outcome: 'refuse' });
    expect(await rejected.run(command, rejected.lease)).toMatchObject({ kind: 'refused', message:expect.any(String) });
    expect(rejected.providers.draft).not.toHaveBeenCalled();

    const held = fixture();
    vi.mocked(held.providers.judgeResult).mockResolvedValue({ ...pass, outcome: 'hold' });
    expect(await held.run(command, held.lease)).toEqual({ kind: 'held' });

    const aborted = fixture();
    vi.mocked(aborted.providers.judgeResult).mockImplementation(async () => { aborted.controller.abort(); return pass; });
    expect(await aborted.run(command, aborted.lease)).toEqual({ kind: 'canceled' });

    const changed = fixture();
    vi.mocked(changed.authority.revalidate).mockResolvedValue({
      kind: 'current', native: { ...changed.reservation, home: { ...changed.reservation.home, id: 'a-different-house' } },
    });
    expect(await changed.run(command, changed.lease)).toEqual({ kind: 'held' });

    const lostLease = fixture();
    vi.mocked(lostLease.authority.revalidate).mockImplementation(async () => {
      lostLease.invalidate(); return { kind: 'current', native: lostLease.reservation };
    });
    expect(await lostLease.run(command, lostLease.lease)).toEqual({ kind: 'canceled' });
    for (const failed of [rejected, held, aborted, changed, lostLease]) {
      expect(failed.authority.commit).not.toHaveBeenCalled();
      expect(failed.authority.release).toHaveBeenCalledTimes(1);
      expect(failed.coals).toBe(1);
      expect(failed.durable).toBeNull();
      expect(failed.publicEvents.some(event => event.type === 'committed')).toBe(false);
    }

    // The authority owns the final CAS: a race AFTER revalidation still cannot spend or attach.
    const commitRace = fixture();
    vi.mocked(commitRace.authority.commit).mockImplementation(async (_input, lease) => {
      commitRace.controller.abort();
      expect(lease.current()).toBe(false);
      return { kind: 'held' };
    });
    expect(await commitRace.run(command, commitRace.lease)).toEqual({ kind: 'canceled' });
    expect(commitRace.authority.release).toHaveBeenCalledTimes(1);
    expect(commitRace.coals).toBe(1);
    expect(commitRace.publicEvents.some(event => event.type === 'committed')).toBe(false);

    // An unreachable adapter cannot hold the caller forever or keep a late reservation's lease valid.
    vi.useFakeTimers();
    try {
      const timedOut = fixture();
      let lateLease: Parameters<KingdomForgeAuthority['reserve']>[1] | undefined;
      vi.mocked(timedOut.authority.reserve).mockImplementation(async (_input, lease) => {
        lateLease = lease; return new Promise(() => {});
      });
      vi.mocked(timedOut.authority.release).mockImplementation(async () => new Promise(() => {}));
      const waiting = timedOut.run(command, timedOut.lease);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await waiting).toMatchObject({ kind: 'recovery-needed' });
      expect(lateLease?.signal.aborted).toBe(true);
      expect(lateLease?.current()).toBe(false);
      expect(timedOut.providers.judgeWords).not.toHaveBeenCalled();
      expect(timedOut.authority.commit).not.toHaveBeenCalled();
      expect(timedOut.coals).toBe(1);
    } finally { vi.useRealTimers(); }
  }, 20_000);
});
