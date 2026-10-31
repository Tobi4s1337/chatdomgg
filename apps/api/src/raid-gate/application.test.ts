import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import { createRaidGateApplication } from './application';
import { readGateReply, type GateContext, type GateReply, type GateRole, type GateTarget } from './contracts';
import { createMemoryRaidGateRepository } from './memory-repository';
import type { GatePolicy, SourceStanding } from './ports';

const SOURCE = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const FERN = KingdomIdSchema.parse('41000003');
const CLOSED = KingdomIdSchema.parse('41000004');
const MONARCH = PersonIdSchema.parse('41000001');
const WREN = PersonIdSchema.parse('52000001');
const OAK = PersonIdSchema.parse('52000002');

const target = (kingdomId: GateTarget['kingdomId'], live = true, classification: GateTarget['classification'] = 'general'): GateTarget => ({ kingdomId, founded: kingdomId === MIRA, live, classification });

function setup(standing: Partial<SourceStanding> = {}) {
  let clock = 1_800_000_000_000;
  let issued = 0;
  const repository = createMemoryRaidGateRepository();
  const policy = {
    readStanding: vi.fn<GatePolicy['readStanding']>(async principal => ({
      session: 'current', broadcaster: principal.personId === MONARCH, live: true, raids: 'granted', actions: 'enabled', ...standing,
    })),
    readTarget: vi.fn<GatePolicy['readTarget']>(async (_from, id) => {
      if (id === MIRA || id === FERN) return { target: target(id), permitted: true };
      if (id === CLOSED) return { target: target(id, false), permitted: true };
      return null;
    }),
  };
  const changes: string[] = [];
  const app = createRaidGateApplication({
    repository, policy, origin: 'simulated',
    tokens: { issue: () => `preview-${++issued}`, hash: async value => value.replace(/\D/g, '').padStart(64, 'a') },
    notifier: { changed: change => changes.push(`${change.requestId}@${change.revision}`) },
  });
  const as = (personId: typeof MONARCH, sourceRole: GateRole = personId === MONARCH ? 'monarch' : 'citizen') =>
    async (command: unknown): Promise<GateReply> => {
      const context: GateContext = { principal: { personId, sessionId: `session-${personId}`, sourceKingdomId: SOURCE, sourceRole }, now: clock, signal: new AbortController().signal };
      const reply = await app.handle(context, command);
      // Every reply the application produces must survive the browser's own reader unchanged.
      expect(readGateReply(structuredClone(reply))).toEqual(reply);
      return reply;
    };
  return { repository, policy, changes, as, monarch: as(MONARCH), wren: as(WREN), oak: as(OAK), advance: (ms: number) => { clock += ms; } };
}

describe('Raid Gate preview and party', () => {
  it('refuses a crown or a role before asking the authority anything', async () => {
    const { policy, wren } = setup();
    const crowned = setup();
    expect(await wren({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await crowned.as(OAK, 'monarch')({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'unauthorized' });
    for (const each of [policy, crowned.policy]) {
      expect(each.readStanding).not.toHaveBeenCalled();
      expect(each.readTarget).not.toHaveBeenCalled();
    }
  });

  it('refuses commands that try to name their own actor', async () => {
    const { monarch, repository } = setup();
    expect(await monarch({ op: 'preview', requestId: 'r1', target: MIRA, actor: MONARCH })).toEqual({ kind: 'denied', code: 'invalid' });
    expect(await monarch({ op: 'join', requestId: 'r1', role: 'monarch' })).toEqual({ kind: 'denied', code: 'invalid' });
    expect(repository.commits).toBe(0);
  });

  it('explains a missing grant to the monarch only, and never previews without it', async () => {
    const { monarch, wren } = setup({ raids: 'missing' });
    expect(await monarch({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { viewer: 'monarch', authority: 'not-connected', open: null } });
    expect(await wren({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { viewer: 'walker', authority: null } });
    expect(await monarch({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'unauthorized' });
    const offline = setup({ live: false });
    expect(await offline.monarch({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'unavailable' });
  });

  it('previews only a live, known destination', async () => {
    const { monarch } = setup();
    expect(await monarch({ op: 'preview', requestId: 'r1', target: CLOSED })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(await monarch({ op: 'preview', requestId: 'r1', target: KingdomIdSchema.parse('99') })).toEqual({ kind: 'denied', code: 'invalid' });
    expect(await monarch({ op: 'preview', requestId: 'r1', target: SOURCE })).toEqual({ kind: 'denied', code: 'invalid' });
  });

  it('counts each walker once, by their own choice, and lets them stay', async () => {
    const { monarch, wren, oak, changes } = setup();
    const preview = await monarch({ op: 'preview', requestId: 'r1', target: MIRA });
    expect(preview).toMatchObject({ kind: 'preview', value: { requestId: 'r1', from: SOURCE, to: MIRA, optedIn: 0, target: { founded: true } } });
    expect(await wren({ op: 'gate' })).toMatchObject({ value: { open: { requestId: 'r1', to: MIRA, optedIn: 0, joined: false } } });
    await wren({ op: 'join', requestId: 'r1' });
    expect(await wren({ op: 'join', requestId: 'r1' })).toMatchObject({ kind: 'party', value: { joined: true, optedIn: 1 } });
    expect(await oak({ op: 'join', requestId: 'r1' })).toMatchObject({ value: { joined: true, optedIn: 2 } });
    expect(await oak({ op: 'leave', requestId: 'r1' })).toMatchObject({ value: { joined: false, optedIn: 1 } });
    expect(await oak({ op: 'leave', requestId: 'r1' })).toMatchObject({ value: { joined: false, optedIn: 1 } });
    expect(await monarch({ op: 'gate' })).toMatchObject({ value: { authority: 'ready', open: { optedIn: 1, joined: false } } });
    expect(changes).toEqual(['r1@1', 'r1@2', 'r1@3', 'r1@4']);
  });

  it('keeps the party when the same decision is refreshed, and ends it when the destination changes', async () => {
    const { monarch, wren, repository } = setup();
    await monarch({ op: 'preview', requestId: 'r1', target: MIRA });
    await wren({ op: 'join', requestId: 'r1' });
    const hash = repository.snapshot().actions[0]?.previewTokenHash;
    expect(await monarch({ op: 'preview', requestId: 'r1', target: MIRA })).toMatchObject({ value: { optedIn: 1 } });
    expect(repository.snapshot().actions[0]?.previewTokenHash).not.toBe(hash);
    expect(await monarch({ op: 'preview', requestId: 'r1', target: FERN })).toEqual({ kind: 'denied', code: 'invalid' });
    expect(await monarch({ op: 'preview', requestId: 'r2', target: FERN })).toMatchObject({ value: { to: FERN, optedIn: 0 } });
    expect(await wren({ op: 'join', requestId: 'r1' })).toEqual({ kind: 'denied', code: 'stale' });
    expect(await wren({ op: 'gate' })).toMatchObject({ value: { open: { requestId: 'r2', joined: false } } });
    expect(await wren({ op: 'read-action', requestId: 'r1' })).toMatchObject({ value: { state: 'cancelled' } });
  });

  it('ends the choice when the preview lapses', async () => {
    const { monarch, wren, advance } = setup();
    await monarch({ op: 'preview', requestId: 'r1', target: MIRA });
    await wren({ op: 'join', requestId: 'r1' });
    advance(120_000);
    expect(await wren({ op: 'gate' })).toMatchObject({ value: { open: null } });
    expect(await wren({ op: 'join', requestId: 'r1' })).toEqual({ kind: 'denied', code: 'stale' });
    expect(await wren({ op: 'leave', requestId: 'r1' })).toMatchObject({ value: { joined: false, optedIn: 0 } });
    expect(await monarch({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'stale' });
  });

  it('answers commands the gate does not perform yet as unavailable, never as success', async () => {
    const { monarch, repository } = setup();
    expect(await monarch({ op: 'start', requestId: 'r1', previewToken: 'preview-1' })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(repository.commits).toBe(0);
  });
});

describe('Raid Gate replies in the browser', () => {
  it('refuses a walker view that carries the monarch grant, and a landing without its raid', () => {
    expect(readGateReply({ kind: 'gate', value: { kingdomId: SOURCE, viewer: 'walker', authority: 'revoked', open: null } })).toBeUndefined();
    expect(readGateReply({ kind: 'action', value: { requestId: 'r1', revision: 2, from: SOURCE, to: MIRA, state: 'landed', observedAt: 1, raid: null } })).toBeUndefined();
    expect(readGateReply({ kind: 'passport', value: { hidden: true, revision: 1, stamps: [{ id: 's', kingdomId: MIRA, occurredAt: 1, kind: 'visit', raidId: null }], nextCursor: null } })).toBeUndefined();
  });
});
