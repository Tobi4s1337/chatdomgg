import { describe, expect, it, vi } from 'vitest';
import { createCastleModule, createHome } from '@chatdom/content';
import { assembleForge, findForgeSockets, forgeStyleKit } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type ForgeDraft } from '@chatdom/shared';
import type { ForgeProviders } from '../providers';
import { FORGE_JUDGE_POLICY_VERSION, type ForgeWishSubject } from '../providers/policy';
import { renderForgeContactSheet } from '../contact-sheet';
import { createKingdomForgeApplication } from './application';
import { bindForgeCandidate } from './candidate';
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
/** What both controlled gates read from the dragon wish's words. Quality is computed by the host, never read. */
const dragonWish: ForgeWishSubject = { motif: 'sleeping-dragon', slot: 'chimney' };
const pass = { outcome: 'pass' as const, reason: 'passed', records: [{ judge: 'controlled-test-judge', status: 'complete' }], subject: dragonWish };
const read = (subject: ForgeWishSubject) => ({ ...pass, subject });

/** Controlled authority only for this test. No test authorization implementation is exported to applications. */
function fixture(origin: KingdomForgeAuthority['origin'] = 'live', onPublish?: (event: ForgeActivity) => void, words = command.words) {
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
      const audit = audits.at(-1)!;
      expect([audit.verdicts[0]?.outcome, audit.verdicts[audit.selection?.verdict ?? 1]?.outcome]).toEqual(['pass', 'pass']);
      expect(input.expectedRevision).toBe(reservation.revision);
      expect(input.expectedHomeDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(input.creation.words).toBe(words);
      coals--;
      durable = input.attachment;
      return { kind: 'committed' as const, committedAt: now };
    }),
    release: vi.fn(async () => {}),
  };
  const run = createKingdomForgeApplication({
    authority, providers, now: () => now, record: async audit => { audits.push(audit); },
    publish: event => { onPublish?.(event); if (event.type === 'committed') expect(durable).not.toBeNull(); publicEvents.push(event); },
  });
  return { run, authority, providers, publicEvents, audits, reservation, controller,
    lease: { signal: controller.signal, current: () => current },
    invalidate: () => { current = false; }, get coals() { return coals; }, get durable() { return durable; } };
}

describe('the kingdom Forge application', () => {
  it('binds the exact current kit that generated the judged sheet and attachment while revision two stays a preview', async () => {
    const moonWish = { ...command, words: 'A borrowed moon for my lantern' };
    const f = fixture('live', undefined, moonWish.words), lantern: ForgeDraft = {
      plan: { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' },
      title: 'The moon at home', plaque: 'A borrowed moon beside the hearth.',
    };
    vi.mocked(f.providers.draft).mockResolvedValue(lantern);
    vi.mocked(f.providers.judgeWords).mockResolvedValue(read({ motif: 'crescent-moon', slot: 'lantern' }));
    vi.mocked(f.providers.judgeResult).mockResolvedValue(read({ motif: 'crescent-moon', slot: 'lantern' }));
    expect(await f.run(moonWish, f.lease)).toMatchObject({ kind: 'committed', attachment: { kitId: 'hearth-native', kitRevision: 1 } });
    // A certified, exactly-read subject in its named slot needs no quiet redraft and no second result read.
    expect(f.audits[0]?.selection).toMatchObject({ delivery: 'delivered', shared: 'subject' });
    expect(f.providers.draft).toHaveBeenCalledTimes(1);
    expect(f.providers.judgeResult).toHaveBeenCalledTimes(1);
    const socket = findForgeSockets(f.reservation.home).find(socket => socket.kind === lantern.plan.kind)!;
    const current = assembleForge(lantern.plan, forgeStyleKit(f.reservation.family), socket);
    const preview = assembleForge(lantern.plan, forgeStyleKit(f.reservation.family, 2),
      findForgeSockets(f.reservation.home, 'street-home', 2).find(socket => socket.kind === lantern.plan.kind)!);
    const sheet = (piece: typeof current) => renderForgeContactSheet(piece.blueprint, { home: f.reservation.home, origin: piece.socket.origin });
    const judged = vi.mocked(f.providers.judgeResult).mock.calls[0]![0];
    expect(judged.contactSheet).toBe(sheet(current));
    expect(judged.contactSheet).not.toBe(sheet(preview));
    expect(f.audits[0]?.candidate).toEqual(bindForgeCandidate(lantern, f.reservation.home, current.kit));
    expect(f.durable).toMatchObject({ kitId: current.kit.id, kitRevision: current.kit.revision, draft: lantern });
  });

  it('keeps host-computed quality in the private audit and charges once for a safe delivered piece', async () => {
    // Both gates agree the words name no catalogue subject: the closest kit piece is delivered once, softened.
    const teapot = { ...command, words: 'A little teapot steaming on my chimney' };
    const f = fixture('live', undefined, teapot.words), unsupported = { motif: 'none', slot: 'chimney' } as const;
    vi.mocked(f.providers.judgeWords).mockResolvedValue(read(unsupported));
    vi.mocked(f.providers.judgeResult).mockResolvedValue(read(unsupported));
    expect(await f.run(teapot, f.lease)).toMatchObject({ kind: 'committed', privateMessage: expect.stringContaining('closest') });
    const quality = { policy: FORGE_JUDGE_POLICY_VERSION, recognisability: 0.3, completeness: 1, cleanMarks: 1, score: 0.58 };
    expect(f.audits[0]?.verdicts[1]).toMatchObject({ quality, detailMatch: 'adapted', subject: unsupported, measure: {
      words: unsupported, result: unsupported, plan: { motif: 'sleeping-dragon', kind: 'chimney' }, certificate: 'reads', slotAvailable: true,
    } });
    expect(f.audits[0]?.selection).toMatchObject({ delivery: 'softened', reason: 'vocabulary' });
    // An unsupported subject's closest piece is final: no quality retry is spent on it.
    expect(f.providers.draft).toHaveBeenCalledTimes(1);
    expect(f.providers.judgeResult).toHaveBeenCalledTimes(1);
    for (const value of ['recognisability', 'measure', 'certificate']) {
      expect(JSON.stringify(f.publicEvents)).not.toContain(value);
      expect(JSON.stringify(f.durable)).not.toContain(value);
    }
    expect(f.publicEvents.filter(event => event.type === 'committed')).toHaveLength(1);
    expect(f.coals).toBe(0);
    expect(await f.run(teapot, f.lease)).toEqual({ kind: 'already-committed' });
    expect(f.authority.commit).toHaveBeenCalledTimes(1);
    expect(f.coals).toBe(0);
  });

  it('keeps both retry detail summaries privately while retaining only selected result evidence', async () => {
    // Hearth's copper owl is certified unreadable; the native owl reads. The retry is told to choose a readable finish.
    const owl = { ...command, words: 'A little owl watching from my chimney' }, owlWish = { motif: 'watchful-owl', slot: 'chimney' } as const;
    const f = fixture('live', undefined, owl.words);
    const owlDraft = (finish: 'copper' | 'native'): ForgeDraft => ({
      plan: { version: 2, kind: 'chimney', motif: 'watchful-owl', finish, accent: 'none' },
      title: 'The chimney owl', plaque: 'A patient owl keeps watch over the hearth.' });
    vi.mocked(f.providers.judgeWords).mockResolvedValue(read(owlWish));
    vi.mocked(f.providers.judgeResult).mockResolvedValue(read(owlWish));
    vi.mocked(f.providers.draft).mockResolvedValueOnce(owlDraft('copper')).mockResolvedValueOnce(owlDraft('native'));
    expect(await f.run(owl, f.lease)).toMatchObject({ kind: 'committed', attachment: { draft: owlDraft('native') } });
    expect(f.providers.judgeResult).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.providers.draft).mock.calls[0]![0]).not.toHaveProperty('feedback');
    expect(vi.mocked(f.providers.draft).mock.calls[1]![0].feedback).toContain('readable finishes');
    expect(f.audits[0]).toMatchObject({ attempts: 2, selection: { verdict: 2, delivery: 'retried', shared: 'subject' }, verdicts: [
      { outcome: 'pass', subject: owlWish },
      { detailMatch: 'adapted', quality: { recognisability: 0.6, score: 0.76 }, records: [] },
      { detailMatch: 'met', quality: { recognisability: 1, score: 1 }, records: pass.records, subject: owlWish,
        measure: { certificate: 'reads', plan: { motif: 'watchful-owl', kind: 'chimney' } } },
    ] });
    // The unselected attempt keeps only its bounded summary, never its reading or measure.
    expect(f.audits[0]?.verdicts[1]).not.toHaveProperty('measure');
    expect(f.audits[0]?.verdicts[1]).not.toHaveProperty('subject');
    for (const key of ['detailMatch', 'quality', 'measure']) expect(f.audits[0]?.verdicts[0]).not.toHaveProperty(key);
    expect(JSON.stringify(f.publicEvents)).not.toContain('detailMatch');
    expect(JSON.stringify(f.durable)).not.toContain('detailMatch');
    expect(f.coals).toBe(0);
  });

  it('softens safe high-scoring pieces with unverifiable details without exposing private scores or a refusal beat', async () => {
    // The result gate's independent reading of the words disagrees with the word gate: the subject stays disputed.
    const f = fixture();
    vi.mocked(f.providers.judgeResult).mockResolvedValue(read({ motif: 'none', slot: 'chimney' }));
    expect(await f.run(command, f.lease)).toMatchObject({ kind: 'committed', privateMessage: expect.stringContaining('closest') });
    expect(f.providers.judgeResult).toHaveBeenCalledTimes(2);
    const disputed = { detailMatch: 'unclear', quality: { recognisability: 0.7, score: 0.82 } };
    expect(f.audits[0]).toMatchObject({ judgment: 'approved', selection: { delivery: 'softened', reason: 'quality', shared: 'slot' }, verdicts: [
      { outcome: 'pass' }, disputed, disputed,
    ] });
    expect(f.publicEvents.map(event => event.type)).not.toContain('ended');
    expect(JSON.stringify(f.publicEvents)).not.toContain('detailMatch');
    expect(JSON.stringify(f.durable)).not.toContain('detailMatch');
    expect(f.authority.commit).toHaveBeenCalledTimes(1);
    expect(f.coals).toBe(0);
  });
  it.each(['refused', 'held', 'canceled'] as const)('ends a staged %s run privately before reservation cleanup finishes', async kind => {
    const f = fixture();
    vi.mocked(f.providers.judgeWords).mockImplementation(async () => {
      if (kind === 'canceled') f.controller.abort();
      return { ...pass, outcome: kind === 'refused' ? 'refuse' : 'hold', reason: 'PRIVATE controlled verdict' };
    });
    let release!: () => void, releasing!: () => void;
    const cleanupStarted = new Promise<void>(resolve => { releasing = resolve; });
    vi.mocked(f.authority.release).mockImplementation(() => {
      releasing(); return new Promise<void>(resolve => { release = resolve; });
    });
    const running = f.run(command, f.lease);
    await cleanupStarted;
    try {
      const stage = f.publicEvents[0];
      expect(stage).toMatchObject({ type: 'stage', stage: 'judging-words' });
      expect(f.publicEvents).toEqual([stage, { type: 'ended', activityId: stage?.activityId }]);
      expect(f.authority.commit).not.toHaveBeenCalled();
      expect(f.coals).toBe(1);
    } finally { release(); }
    expect(await running).toMatchObject({ kind });
  });

  it('emits no ending when reserve fails, validation fails before a stage, or every stage publication throws', async () => {
    const denied = fixture();
    vi.mocked(denied.authority.reserve).mockResolvedValue({ kind: 'held' });
    expect(await denied.run(command, denied.lease)).toEqual({ kind: 'held' });
    expect(denied.publicEvents).toEqual([]);

    const invalid = fixture();
    Object.assign(invalid.reservation, { safetyIdentifier: 'invalid' });
    expect(await invalid.run(command, invalid.lease)).toEqual({ kind: 'held' });
    expect(invalid.publicEvents).toEqual([]);

    const publish = vi.fn(() => { throw new Error('SIMULATED unavailable broadcast'); });
    const unobserved = fixture('live', publish);
    vi.mocked(unobserved.providers.judgeWords).mockResolvedValue({ ...pass, outcome: 'hold' });
    expect(await unobserved.run(command, unobserved.lease)).toMatchObject({ kind: 'held', privateMessage: pass.reason });
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'stage' }));
    expect(unobserved.publicEvents).toEqual([]);
  });

  it('does not end a confirmed durable commit even when its publication cancels the caller', async () => {
    const f = fixture('live', event => { if (event.type === 'committed') f.controller.abort(); });
    expect(await f.run(command, f.lease)).toMatchObject({ kind: 'committed' });
    expect(f.publicEvents.some(event => event.type === 'ended')).toBe(false);
    expect(f.authority.release).not.toHaveBeenCalled();
    expect(f.coals).toBe(0);
  });

  it('derives the castle profile from the reservation and rejects a changed authoritative profile', async () => {
    const accepted = fixture();
    Object.assign(accepted.reservation, { home: createCastleModule('keep', [32, 31, 32], 'hearth'), hostProfile: 'castle-keep', slot: 65_534 });
    expect(await accepted.run(command, accepted.lease)).toMatchObject({ kind: 'committed', attachment: {
      slot: 65_534, hostId: 'castle-hearth', hostProfile: 'castle-keep',
    } });
    expect(accepted.providers.draft).toHaveBeenCalledWith(expect.objectContaining({ availableSockets: expect.arrayContaining([
      expect.objectContaining({ hostProfile: 'castle-keep', profile: 'roof' }),
    ]) }));
    expect(accepted.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(accepted.coals).toBe(0);

    const changed = fixture();
    Object.assign(changed.reservation, { home: createCastleModule('keep', [32, 31, 32], 'hearth'), hostProfile: 'castle-keep', slot: 65_534 });
    vi.mocked(changed.authority.revalidate).mockResolvedValue({ kind: 'current', native: { ...changed.reservation, hostProfile: 'street-home' } });
    expect(await changed.run(command, changed.lease)).toEqual({ kind: 'held' });
    expect(changed.authority.commit).not.toHaveBeenCalled();
    expect(changed.coals).toBe(1);
  });
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
    expect(accepted.publicEvents.some(event => event.type === 'ended')).toBe(false);

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
    expect(await held.run(command, held.lease)).toMatchObject({ kind: 'held', privateMessage: pass.reason });

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
      expect(failed.publicEvents.at(-1)).toEqual({ type: 'ended', activityId: failed.publicEvents[0]?.activityId });
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
    expect(commitRace.publicEvents.at(-1)).toEqual({ type: 'ended', activityId: commitRace.publicEvents[0]?.activityId });

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
  }, 60_000);
});
