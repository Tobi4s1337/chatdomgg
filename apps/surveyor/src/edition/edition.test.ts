import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSettlersAppendOnly, type AtlasSettler } from '@chatdom/shared';
import { LATTICE, latticePoint, parseSlotHoldingId, realmCapacity, slotFits, slotHoldingId } from '../cartography/slots';
import { currentTaxonomyText, loadTaxonomy } from '../cartography/taxonomy';
import { runImport } from '../import';
import { WITHHELD_FILE, publicVisibility } from '../policy/visibility';
import { FixtureSource, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { founderKey, signAuthorization, verifyAuthorization } from './authorization';
import { runAuthorize, runFound, runSettle } from './commands';
import { draftEdition, foundingGates, type DraftEdition, type FoundingGateInput } from './found';
import { applyEvent, emptyState, encodeLine, extendLedger, headHolds, replayLedger, type LedgerEvent, type LedgerState } from './ledger';
import { EDITIONS, EditionWorldSchema, LedgerLineSchema, type AuthorizationPayload, type EditionNumber, type EditionWorld, type LedgerHead } from './schema';
import {
  GONE_RETURN_MS, apparentTier, editionContext, holdingRadius, holdingState, holdingTierFor, occupancyOf, settleNight,
  type EditionContext, type HoldingTier, type NightResult,
} from './settle';
import { FOUNDINGS_LOG, appendSettlement, editionDir, readEditionFiles, verifyEditionDir, writeNewEdition } from './store';
import { verifyEdition, type EditionFiles } from './verify';
import { DAY, HOUR, T0, planChannels, raid, revision, synthId, testKeys, x25519PublicKey, type ChannelSpec, type Revision } from './fixtures.test-support';
import { allowRealImports } from '../test/timeouts';

allowRealImports();

// ── A small synthetic kingdom map ─────────────────────────────────────────────────────────────────────────────
// Three languages, each an isle (no language reaches the continent threshold), plus a gone and a gambling candidate
// that must never receive land. Later revisions add newcomers, raise averages, hide, lose and restore channels.

const TAXONOMY = currentTaxonomyText();
const TAXONOMY_REF = loadTaxonomy(TAXONOMY).ref;
const ASOF1 = T0 + 49 * HOUR;
const FOUNDED_AT = ASOF1 + HOUR;
const SLOTS_GAME = '498566';

const BASE: ChannelSpec[] = [
  ...planChannels([{ code: 'de', candidates: 60, small: 20 }, { code: 'ja', candidates: 20, small: 5 }, { code: 'fr', candidates: 8 }], 11),
  { n: 900, language: 'de', average: 80, goneAt: ASOF1 - 3 * HOUR },
  { n: 901, language: 'de', average: 300, categories: [{ gameId: SLOTS_GAME, minutes: 600 }] },
];
const rev1 = revision({ asOf: ASOF1, specs: BASE, tag: 'base' });

const TIERS: readonly HoldingTier[] = ['hamlet', 'village', 'town', 'city', 'capital'];
const nOf = (kingdomId: string) => Number(kingdomId.slice(1));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const at = (hours: number) => ASOF1 + hours * HOUR;

type Settle = Extract<LedgerEvent, { kind: 'settle' }>;
const settles = (result: NightResult) => result.events.filter((event): event is Settle => event.kind === 'settle');

function draft(number: EditionNumber, rev: Revision, taxonomyText = TAXONOMY, foundedAt = FOUNDED_AT, withheld: ReadonlySet<string> = new Set()): DraftEdition {
  return draftEdition({ number, manifest: rev.manifest, channels: rev.channels, games: rev.games, taxonomyText, foundedAt, withheld });
}

const headOf = (state: LedgerState, rev: string): LedgerHead => ({ version: 1, lines: state.lines, settlers: state.settlers.length, head: state.head, revision: rev, at: FOUNDED_AT });

/** One edition's ledger as it grows night by night, with every head acknowledged. */
interface Chain { draft: DraftEdition; ctx: EditionContext; number: EditionNumber; state: LedgerState; text: string; heads: LedgerHead[] }

function start(d: DraftEdition, number: EditionNumber): Chain {
  return { draft: d, ctx: editionContext(d.world, loadTaxonomy(d.taxonomyText)), number, state: d.state, text: d.ledgerText, heads: [headOf(d.state, d.world.revision)] };
}

function night(chain: Chain, rev: Revision, withheld: ReadonlySet<string> = new Set()): { chain: Chain; result: NightResult } {
  const result = settleNight({
    number: chain.number, ctx: chain.ctx, state: chain.state, manifest: rev.manifest, channels: rev.channels,
    raidPairs: [], raidObservations: rev.raidObservations, withheld,
  });
  const { text, next } = extendLedger(chain.state, result.events);
  return { result, chain: { ...chain, state: next, text: chain.text + text, heads: [...chain.heads, headOf(next, rev.manifest.revision)] } };
}

const filesOf = (chain: Chain, ledgerText = chain.text, heads = chain.heads): EditionFiles => ({
  edition: chain.draft.edition, worldBytes: chain.draft.worldBytes, taxonomyText: chain.draft.taxonomyText, ledgerText, heads, founding: null,
});

const realmOfLanguage = (world: EditionWorld, language: string) => world.realms.find((realm) => world.regions[realm.region]!.language === language)!.index;

/** Every way a slot holding can break R3/R5: off the lattice, outside its realm, without a shore, or too close. */
function slotProblems(ctx: EditionContext, settler: AtlasSettler, all: readonly AtlasSettler[]): string[] {
  const problems: string[] = [];
  const slot = parseSlotHoldingId(settler.holdingId);
  if (!slot) return [`${settler.holdingId} is not a slot`];
  const p = latticePoint(slot.i, slot.j);
  if (p.x !== settler.point.x || p.y !== settler.point.y) problems.push(`${settler.holdingId} is off its lattice point`);
  if (!Number.isInteger(settler.point.x * 20) || !Number.isInteger(settler.point.y * 20)) problems.push(`${settler.holdingId} is not on the 1/20 grid`);
  if (ctx.land.realmAt(p.x, p.y) !== settler.realmIndex) problems.push(`${settler.holdingId} is outside realm ${settler.realmIndex}`);
  const r = holdingRadius(ctx.world, settler.holdingTier);
  if (ctx.land.distanceToCoast(p.x, p.y, r + LATTICE.shore) < r + LATTICE.shore) problems.push(`${settler.holdingId} has no shore`);
  for (const other of all) {
    if (other.ordinal === settler.ordinal) continue;
    const min = r + holdingRadius(ctx.world, other.holdingTier) + ctx.world.lattice.gap - 1e-6;
    if (Math.hypot(other.point.x - p.x, other.point.y - p.y) < min) problems.push(`${settler.holdingId} crowds ${other.holdingId}`);
  }
  return problems;
}

let d0: DraftEdition;
let dI: DraftEdition;
beforeAll(() => {
  d0 = draft('0', rev1);
  dI = draft('I', rev1);
}, 60_000);

// ── 1. Reproducibility ────────────────────────────────────────────────────────────────────────────────────────

describe('founding a draft edition', () => {
  it('draws byte-identical land, ledger and world hash from the same revision, taxonomy and algorithm', () => {
    const again = draft('0', rev1, TAXONOMY, FOUNDED_AT + 5 * DAY);
    expect(Buffer.from(again.worldBytes).equals(Buffer.from(d0.worldBytes))).toBe(true);
    expect(again.edition.worldHash).toBe(d0.edition.worldHash);
    expect(again.ledgerText).toBe(d0.ledgerText);
    expect(again.state.head).toBe(d0.state.head);
    expect(again.settlers).toEqual(d0.settlers);
    // The founding date is metadata; it is not part of the land.
    expect(again.edition.foundedAt).not.toBe(d0.edition.foundedAt);

    expect(d0.edition).toMatchObject({ id: 'ed-0', label: 'Edition 0', status: 'frozen', worldHash: sha(d0.worldBytes), realmCount: d0.world.realms.length });
    const world = EditionWorldSchema.parse(JSON.parse(new TextDecoder().decode(d0.worldBytes)));
    expect(world).toMatchObject({
      edition: 'ed-0', revision: rev1.manifest.revision, asOf: ASOF1,
      taxonomy: { id: 'families-1', status: 'proposed', sha256: TAXONOMY_REF.sha256, variety: 'variety-1' },
    });
    // Edition I differs only in its edition field, which is part of the frozen bytes.
    expect(dI.edition.worldHash).not.toBe(d0.edition.worldHash);
    expect(dI.settlers).toEqual(d0.settlers);
  });

  it('names the exact taxonomy bytes: a different taxonomy text gives a different world hash and ledger', () => {
    const compact = JSON.stringify(JSON.parse(TAXONOMY));
    expect(compact).not.toBe(TAXONOMY);
    const other = draft('0', rev1, compact);
    expect(other.world.taxonomy.sha256).toBe(sha(compact));
    expect(other.edition.worldHash).not.toBe(d0.edition.worldHash);
    // The ledger's genesis is bound to the world hash, so even identical settlements chain differently.
    expect(other.settlers).toEqual(d0.settlers);
    expect(other.state.head).not.toBe(d0.state.head);
    expect(() => editionContext(d0.world, loadTaxonomy(compact))).toThrow(/not the one this edition was drawn with/);
    expect(() => replayLedger(other.ledgerText, d0.edition)).toThrow(/does not continue the chain/);
  });

  it('settles every public candidate once, in channel ID order, and no gone, gambling or small channel', () => {
    const expected = rev1.channels.filter((channel) => channel.kingdomCandidate && publicVisibility(channel) === 'public').map((channel) => channel.kingdomId);
    expect(expected.length).toBe(88);
    expect(d0.settlers.map((settler) => settler.kingdomId)).toEqual(expected);
    expect(expected).not.toContain(synthId(900));
    expect(expected).not.toContain(synthId(901));
    const byId = new Map(rev1.channels.map((channel) => [channel.kingdomId as string, channel]));
    d0.settlers.forEach((settler, ordinal) => {
      expect(settler).toMatchObject({ ordinal, holdingId: `f:${ordinal}`, settledAt: ASOF1, holdingTier: holdingTierFor(byId.get(settler.kingdomId)!.averageViewers) });
      expect(d0.world.realms[settler.realmIndex]!.kind).toBe('isle');
    });
    const replayed = replayLedger(d0.ledgerText, d0.edition);
    expect(replayed.settlers).toEqual(d0.settlers);
    expect(replayed.head).toBe(d0.state.head);
    expect(replayed.lastNight).toEqual({ revision: rev1.manifest.revision, asOf: ASOF1 });
    const report = verifyEdition(filesOf(start(d0, '0')), null);
    expect(report.problems).toEqual([]);
    expect(report.stats).toMatchObject({ settlers: 88, byReason: { founding: 88 }, outer: 0, tombstoned: 0, nights: 1, heads: 1 });
  });

  it('settles a channel withheld at founding on its drawn land, tombstoned as hidden before the first night ends', () => {
    const [first, second] = [d0.settlers[2]!, d0.settlers[40]!];
    const withheld = new Set([second.kingdomId, first.kingdomId, synthId(900), 'k999999999']);
    const hid = draft('0', rev1, TAXONOMY, FOUNDED_AT, withheld);
    // Withholding names nothing in the land: the world and every holding are the ones drawn without it.
    expect(hid.edition.worldHash).toBe(d0.edition.worldHash);
    expect(hid.settlers).toEqual(d0.settlers);
    // Settlements, then one hidden tombstone per withheld holder in ordinal order, then the night that counts them.
    const lines = hid.ledgerText.trim().split('\n').map((raw) => LedgerLineSchema.parse(JSON.parse(raw)));
    expect(lines.slice(0, 88).every((line) => line.kind === 'settle')).toBe(true);
    expect(lines.slice(88)).toEqual([
      expect.objectContaining({ kind: 'tombstone', kingdomId: first.kingdomId, holdingId: first.holdingId, cause: 'hidden', at: ASOF1, revision: rev1.manifest.revision }),
      expect.objectContaining({ kind: 'tombstone', kingdomId: second.kingdomId, holdingId: second.holdingId, cause: 'hidden', at: ASOF1, revision: rev1.manifest.revision }),
      expect.objectContaining({ kind: 'night', revision: rev1.manifest.revision, asOf: ASOF1, settled: 88, byRaid: 0, outer: 0, tombstones: 2, restores: 0, deferred: 0 }),
    ]);
    expect([...hid.state.tombstones]).toEqual([[first.kingdomId, { cause: 'hidden', at: ASOF1 }], [second.kingdomId, { cause: 'hidden', at: ASOF1 }]]);
    expect(holdingState(hid.state.tombstones.get(first.kingdomId), ASOF1)).toBe('waiting');
    // Their land is held: nobody else can be placed on it.
    const chain = start(hid, '0');
    const occupancy = occupancyOf(chain.ctx, hid.state.settlers);
    for (const settler of [first, second]) expect(occupancy.fits(settler.point.x, settler.point.y, d0.world.lattice.hamletRadius)).toBe(false);
    const report = verifyEdition(filesOf(chain), null);
    expect(report.problems).toEqual([]);
    expect(report.stats).toMatchObject({ settlers: 88, tombstoned: 2, nights: 1 });

    // Still withheld the next night: nothing changes. Withheld no longer and observed: both come back.
    const r2 = revision({ asOf: at(24), specs: BASE, tag: 'still-withheld' });
    const n2 = night(chain, r2, withheld);
    expect(n2.result.summary).toMatchObject({ tombstones: 0, restores: 0 });
    const r3 = revision({ asOf: at(48), specs: BASE, tag: 'released' });
    const n3 = night(n2.chain, r3);
    expect(n3.result.events.filter((event) => event.kind === 'restore').map((event) => event.kingdomId)).toEqual([first.kingdomId, second.kingdomId]);
    expect(verifyEdition(filesOf(n3.chain), null).problems).toEqual([]);
  });
});

// ── 2. Append-only settlement ─────────────────────────────────────────────────────────────────────────────────

/** Ten de villages and towns whose average later jumps to a city's. */
const RAISED = BASE.filter((spec) => spec.language === 'de' && spec.average >= 25 && spec.average < 500).slice(0, 10).map((spec) => spec.n);
const NEW_DE = [30, 45, 60, 120, 700, 26, 27, 55, 33, 6_000];
const NEW_JA = [40, 80];
const NEW_NL = [30, 60, 900];
const newcomers = (first: number, language: string, averages: readonly number[]): ChannelSpec[] =>
  averages.map((average, k) => ({ n: first + k, language, average }));
const REV2_SPECS: ChannelSpec[] = [
  ...BASE.map((spec) => (RAISED.includes(spec.n) ? { ...spec, average: spec.average * 4 + 600 } : spec)),
  ...newcomers(1001, 'de', NEW_DE),
  ...newcomers(1011, 'ja', NEW_JA),
  ...newcomers(1013, 'nl', NEW_NL),
  { n: 1020, language: 'de', average: 12 },
];
const rev2 = revision({ asOf: at(24), specs: REV2_SPECS, tag: 'second' });
const rev3 = revision({ asOf: at(48), specs: [...REV2_SPECS, ...newcomers(1030, 'de', [28, 75, 41]), ...newcomers(1033, 'fr', [52])], tag: 'third' });

describe('nightly settlement is append-only', () => {
  let one: { chain: Chain; result: NightResult };
  let two: { chain: Chain; result: NightResult };
  beforeAll(() => {
    one = night(start(d0, '0'), rev2);
    two = night(one.chain, rev3);
  });

  it('leaves every earlier settler exactly as it was', () => {
    const before = d0.settlers;
    expect(() => assertSettlersAppendOnly(before, one.chain.state.settlers)).not.toThrow();
    expect(() => assertSettlersAppendOnly(one.chain.state.settlers, two.chain.state.settlers)).not.toThrow();
    expect(one.chain.state.settlers.slice(0, before.length)).toEqual(before);
    expect(two.chain.state.settlers.slice(0, one.chain.state.settlers.length)).toEqual(one.chain.state.settlers);
    for (const [ordinal, old] of before.entries()) {
      const now = two.chain.state.settlers[ordinal]!;
      expect([now.ordinal, now.kingdomId, now.holdingId, now.realmIndex, now.holdingTier, now.point.x, now.point.y, now.settledAt])
        .toEqual([old.ordinal, old.kingdomId, old.holdingId, old.realmIndex, old.holdingTier, old.point.x, old.point.y, old.settledAt]);
    }
    // The earlier ledger bytes are an exact prefix of the later ledger.
    expect(two.chain.text.startsWith(one.chain.text)).toBe(true);
    expect(one.chain.text.startsWith(d0.ledgerText)).toBe(true);
  });

  it('grants each new public candidate one holding on a free lattice slot in its realm, with shore and gap', () => {
    const { result, chain } = one;
    expect(result.summary).toEqual({ settled: 15, byRaid: 0, outer: 3, tombstones: 0, restores: 0, deferred: 0, unseenRaidTargets: 0 });
    const granted = settles(result);
    expect(granted.map((event) => nOf(event.settler.kingdomId)).sort((a, b) => a - b)).toEqual([...Array.from({ length: 15 }, (_, k) => 1001 + k)]);
    const deRealm = realmOfLanguage(d0.world, 'de');
    const jaRealm = realmOfLanguage(d0.world, 'ja');
    const all = chain.state.settlers;
    for (const event of granted) {
      const { settler } = event;
      const n = nOf(settler.kingdomId);
      const spec = REV2_SPECS.find((s) => s.n === n)!;
      expect(settler.holdingTier).toBe(holdingTierFor(spec.average));
      expect(settler.settledAt).toBe(rev2.manifest.asOf);
      expect(event).toMatchObject({ reason: 'candidate', revision: rev2.manifest.revision });
      expect(slotProblems(chain.ctx, settler, all)).toEqual([]);
      if (spec.language === 'nl') {
        // No land for this language yet: the Outer Isles path, never a new border.
        expect(event.path).toBe('outer');
        expect(d0.world.realms[settler.realmIndex]!.kind).toBe('outer');
      } else {
        expect(event.path).toBe('realm');
        expect(settler.realmIndex).toBe(spec.language === 'de' ? deRealm : jaRealm);
      }
    }
    // Largest first: the 6,000-average newcomer claimed its room before the villages.
    expect(granted[0]!.settler).toMatchObject({ kingdomId: synthId(1010), holdingTier: 'capital', ordinal: d0.settlers.length });
    expect(granted.map((event) => event.settler.ordinal)).toEqual(granted.map((_, k) => d0.settlers.length + k));
  });

  it('verifies after every night, and every acknowledged head still holds', () => {
    for (const { chain } of [one, two]) expect(verifyEdition(filesOf(chain), null).problems).toEqual([]);
    const report = verifyEdition(filesOf(two.chain), null);
    expect(report.stats).toMatchObject({ settlers: 88 + 15 + 4, byReason: { founding: 88, candidate: 19 }, outer: 3, nights: 3, heads: 3 });
    for (const head of two.chain.heads) expect(headHolds(two.chain.text, head)).toBe(true);
    expect(replayLedger(two.chain.text, d0.edition).settlers).toEqual(two.chain.state.settlers);
  });

  it('is pure: the same edition, ledger and revision give the same events', () => {
    expect(night(start(d0, '0'), rev2).result).toEqual(one.result);
  });

  // ── 3. No duplicate owners ──────────────────────────────────────────────────────────────────────────────────

  it('never settles a channel that already holds land, whatever its new average', () => {
    const owners = new Set(d0.settlers.map((settler) => settler.kingdomId as string));
    for (const event of [...settles(one.result), ...settles(two.result)]) expect(owners.has(event.settler.kingdomId)).toBe(false);
    const all = two.chain.state.settlers;
    expect(new Set(all.map((s) => s.kingdomId)).size).toBe(all.length);
    expect(new Set(all.map((s) => s.holdingId)).size).toBe(all.length);
  });

  it('refuses a second holding for one channel and a second owner for one holding', () => {
    const state = replayLedger(one.chain.text, d0.edition);
    const existing = state.settlers[5]!;
    const fresh = state.settlers[state.settlers.length - 1]!;
    const line = (settler: AtlasSettler) => LedgerLineSchema.parse({ seq: state.lines, prev: state.head, kind: 'settle', settler, reason: 'candidate', path: 'realm', revision: rev2.manifest.revision });
    const base = { ordinal: state.settlers.length, realmIndex: existing.realmIndex, holdingTier: 'hamlet' as HoldingTier, point: { x: 1.6, y: 1.4 }, settledAt: at(30) };
    const secondHolding = { ...base, kingdomId: existing.kingdomId, holdingId: slotHoldingId(1, 1) };
    const secondOwner = { ...base, kingdomId: synthId(5_555) as AtlasSettler['kingdomId'], holdingId: fresh.holdingId };
    const foundingOwner = { ...base, kingdomId: synthId(5_556) as AtlasSettler['kingdomId'], holdingId: 'f:0' };
    expect(() => applyEvent(state, line(secondHolding))).toThrow(/already holds land/);
    expect(() => applyEvent(state, line(secondOwner))).toThrow(/already has an owner/);
    expect(() => applyEvent(state, line(foundingOwner))).toThrow(/already has an owner/);
    expect(() => applyEvent(state, line({ ...base, ordinal: base.ordinal + 1, kingdomId: synthId(5_557) as AtlasSettler['kingdomId'], holdingId: slotHoldingId(1, 1) }))).toThrow(/ordinal/);
    expect(state.settlers.length).toBe(one.chain.state.settlers.length);

    const { lines, head } = state;
    const event = (settler: AtlasSettler): LedgerEvent => ({ kind: 'settle', settler, reason: 'candidate', path: 'realm', revision: rev2.manifest.revision });
    expect(() => extendLedger(state, [event(secondHolding)])).toThrow(/already holds land/);
    expect(() => extendLedger(state, [event(secondOwner)])).toThrow(/already has an owner/);
    expect([state.lines, state.head]).toEqual([lines, head]);

    // A forged line, correctly chained and canonically encoded, still cannot replay.
    for (const [settler, message] of [[secondHolding, /already holds land/], [secondOwner, /already has an owner/]] as const) {
      const forged = `${one.chain.text}${encodeLine(lines, head, event(settler))}\n`;
      expect(() => replayLedger(forged, d0.edition)).toThrow(message);
      const report = verifyEdition(filesOf(one.chain, forged), null);
      expect(report.problems).toEqual([expect.stringMatching(/^ledger: .*(already holds land|already has an owner)/)]);
    }
  });

  it('detects a hand-edited ledger: a moved point, reordered lines, a truncated tail, non-canonical spacing', () => {
    const text = one.chain.text;
    const rows = text.split('\n').slice(0, -1);
    const unlines = (list: readonly string[]) => list.map((row) => `${row}\n`).join('');
    const parsed = (row: string) => LedgerLineSchema.parse(JSON.parse(row));
    const ledgerProblem = (ledgerText: string, heads = one.chain.heads) => verifyEdition(filesOf(one.chain, ledgerText, heads), null).problems;

    // A founding holding nudged by 1/20 unit: the next line no longer continues the chain.
    const moved = [...rows];
    const line = parsed(rows[2]!);
    if (line.kind !== 'settle') throw new Error('expected a settle line');
    const { seq, prev, ...event } = line;
    moved[2] = encodeLine(seq, prev, { ...event, settler: { ...event.settler, point: { x: event.settler.point.x + 0.05, y: event.settler.point.y } } });
    expect(() => replayLedger(unlines(moved), d0.edition)).toThrow('ledger line 4 does not continue the chain.');
    expect(ledgerProblem(unlines(moved))[0]).toMatch(/^ledger: ledger line 4 does not continue the chain/);

    // The same edit re-chained from genesis replays, but every acknowledged head exposes it.
    const events = rows.map((row) => Object.fromEntries(Object.entries(parsed(row)).filter(([field]) => field !== 'seq' && field !== 'prev')) as LedgerEvent);
    const forgedEvent = events[2] as Settle;
    events[2] = { ...forgedEvent, settler: { ...forgedEvent.settler, point: { x: forgedEvent.settler.point.x + 0.05, y: forgedEvent.settler.point.y } } };
    const rechained = extendLedger(emptyState(d0.edition.worldHash), events).text;
    expect(() => replayLedger(rechained, d0.edition)).not.toThrow();
    expect(one.chain.heads.every((head) => !headHolds(rechained, head))).toBe(true);
    expect(ledgerProblem(rechained)).toEqual(expect.arrayContaining([expect.stringMatching(/at 89 lines .* is no longer a prefix/), expect.stringMatching(/no head acknowledges/)]));

    // Two lines swapped.
    const swapped = [...rows];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(() => replayLedger(unlines(swapped), d0.edition)).toThrow('ledger line 2 has sequence 2.');

    // A torn last line, a missing final newline, and a cleanly dropped last line.
    expect(() => replayLedger(text.slice(0, -10), d0.edition)).toThrow(/truncated/);
    expect(() => replayLedger(text.slice(0, -1), d0.edition)).toThrow(/truncated/);
    expect(ledgerProblem(text.slice(0, -10))).toEqual(['ledger: the ledger ends in a truncated line.']);
    const dropped = unlines(rows.slice(0, -1));
    expect(() => replayLedger(dropped, d0.edition)).not.toThrow();
    expect(ledgerProblem(dropped)).toEqual(expect.arrayContaining([expect.stringMatching(/is no longer a prefix/)]));

    // Same record, different bytes: a space after a colon, or keys in another order.
    const spaced = [...rows];
    spaced[3] = rows[3]!.replace('"kind":"settle"', '"kind": "settle"');
    expect(JSON.parse(spaced[3]!)).toEqual(JSON.parse(rows[3]!));
    expect(() => replayLedger(unlines(spaced), d0.edition)).toThrow('ledger line 4 is not canonically encoded.');
    const reordered = [...rows];
    const { seq: s3, prev: p3, ...rest3 } = parsed(rows[3]!);
    reordered[3] = JSON.stringify({ prev: p3, seq: s3, ...rest3 });
    expect(() => replayLedger(unlines(reordered), d0.edition)).toThrow('ledger line 4 is not canonically encoded.');

    // And the frozen land itself: one changed byte in world.json.
    const world = Buffer.from(d0.worldBytes);
    const offset = world.indexOf('"asOf":') + 8;
    world.writeUInt8(world.readUInt8(offset) ^ 1, offset);
    const report = verifyEdition({ ...filesOf(one.chain), worldBytes: new Uint8Array(world) }, null);
    expect(report.problems).toEqual(['world.json does not match the edition world hash: frozen land changed.']);
  });

  // ── 6. Growth ─────────────────────────────────────────────────────────────────────────────────────────────

  it('never changes a holding tier in the ledger when a later revision raises the average', () => {
    const byId = new Map(rev2.channels.map((channel) => [channel.kingdomId as string, channel]));
    let grown = 0;
    for (const settler of d0.settlers) {
      if (!RAISED.includes(nOf(settler.kingdomId))) continue;
      const after = two.chain.state.settlers[settler.ordinal]!;
      const average = byId.get(settler.kingdomId)!.averageViewers;
      expect(after.holdingTier).toBe(settler.holdingTier);
      expect(holdingTierFor(average)).not.toBe(settler.holdingTier);
      const drawn = apparentTier(after.holdingTier, average);
      expect(TIERS.indexOf(drawn)).toBe(TIERS.indexOf(settler.holdingTier) + 1);
      grown++;
    }
    expect(grown).toBe(RAISED.length);
  });
});

// ── 6. Growth rules ───────────────────────────────────────────────────────────────────────────────────────────

describe('tiers', () => {
  it('reads the holding tier from the observed average at each boundary', () => {
    const cases: [number, HoldingTier][] = [
      [0, 'hamlet'], [24.99, 'hamlet'], [25, 'village'], [49.99, 'village'], [50, 'town'], [499.99, 'town'],
      [500, 'city'], [4_999.99, 'city'], [5_000, 'capital'], [1e7, 'capital'],
    ];
    for (const [average, tier] of cases) expect(holdingTierFor(average)).toBe(tier);
  });

  it('draws a kingdom at most one tier past its holding and never below it', () => {
    const averages = [0, 10, 24.99, 25, 49.99, 50, 499, 500, 4_999, 5_000, 1e6];
    for (const holding of TIERS) {
      const own = TIERS.indexOf(holding);
      for (const average of averages) {
        const now = TIERS.indexOf(holdingTierFor(average));
        const drawn = TIERS.indexOf(apparentTier(holding, average));
        expect(drawn).toBeGreaterThanOrEqual(own);
        expect(drawn).toBeLessThanOrEqual(own + 1);
        expect(drawn).toBe(Math.max(own, Math.min(now, own + 1)));
      }
    }
    expect(apparentTier('village', 6_000)).toBe('town');
    expect(apparentTier('hamlet', 5_000)).toBe('village');
    expect(apparentTier('town', 600)).toBe('city');
    expect(apparentTier('city', 10)).toBe('city');
    expect(apparentTier('capital', 0)).toBe('capital');
  });
});

// ── 2b. Realms on a continent ─────────────────────────────────────────────────────────────────────────────────

describe('settlement on a continent', () => {
  // en reaches the continent threshold; families 0, 2, 3, 5 and 6 are big enough for their own realm there.
  const STREET_FIGHTER = '55453844'; // fighting (11): too few channels for a realm, so the Wilds
  const asOf = T0 + 60 * HOUR;
  const base = planChannels([{ code: 'en', candidates: 640, small: 30 }, { code: 'de', candidates: 30 }], 23, 20_000);
  let chain: Chain;
  beforeAll(() => {
    const rev = revision({ asOf, specs: base, tag: 'continent' });
    chain = start(draft('0', rev), '0');
  }, 60_000);

  it('places newcomers by family, variety and the Wilds, each on a free slot of that realm', () => {
    const world = chain.draft.world;
    const en = world.regions.find((region) => region.language === 'en')!;
    expect(en.kind).toBe('continent');
    const realmOf = (kind: string, family = -1) => world.realms.find((realm) => realm.region === en.index && realm.kind === kind && realm.family === family)!.index;
    const minutes = (entries: Record<string, number>) => Object.entries(entries).map(([gameId, value]) => ({ gameId, minutes: value }));
    const arrivals: [ChannelSpec, number][] = [
      [{ n: 30_001, language: 'en', average: 40, categories: minutes({ '509658': 300 }) }, realmOf('family', 0)],
      [{ n: 30_002, language: 'en', average: 90, categories: minutes({ '516575': 200, '33214': 150, '509658': 250 }) }, realmOf('family', 2)],
      [{ n: 30_003, language: 'en', average: 35, categories: minutes({ '509658': 100, '21779': 80, '27471': 70 }) }, realmOf('crossroads')],
      [{ n: 30_004, language: 'en', average: 30, categories: minutes({ '499634': 400 }) }, realmOf('wilds')],
      [{ n: 30_005, language: 'en', average: 60, categories: minutes({ [STREET_FIGHTER]: 500 }) }, realmOf('wilds')],
      [{ n: 30_006, language: 'de', average: 45, categories: minutes({ '21779': 300 }) }, realmOfLanguage(world, 'de')],
    ];
    const rev = revision({ asOf: asOf + DAY, specs: [...base, ...arrivals.map(([spec]) => spec)], tag: 'continent-2' });
    const { result, chain: after } = night(chain, rev);
    expect(result.summary).toMatchObject({ settled: arrivals.length, outer: 0, deferred: 0 });
    const granted = new Map(settles(result).map((event) => [nOf(event.settler.kingdomId), event]));
    for (const [spec, realm] of arrivals) {
      const event = granted.get(spec.n)!;
      expect(event.path).toBe('realm');
      expect(event.settler.realmIndex).toBe(realm);
      expect(slotProblems(after.ctx, event.settler, after.state.settlers)).toEqual([]);
    }
    expect(() => assertSettlersAppendOnly(chain.state.settlers, after.state.settlers)).not.toThrow();
    expect(verifyEdition(filesOf(after), null).problems).toEqual([]);
  });
});

// ── 4. Slot exhaustion ────────────────────────────────────────────────────────────────────────────────────────

/** The box around a region's stored coasts, in world units. */
function coastBox(world: EditionWorld, region: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const coast of world.coasts) {
    if (coast.region !== region) continue;
    let x = 0;
    let y = 0;
    for (let p = 0; p < coast.points.length; p += 2) {
      x += coast.points[p]!;
      y += coast.points[p + 1]!;
      minX = Math.min(minX, x / world.coordScale);
      maxX = Math.max(maxX, x / world.coordScale);
      minY = Math.min(minY, y / world.coordScale);
      maxY = Math.max(maxY, y / world.coordScale);
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Hamlets of fake channels on every free slot of the given realms, as settle events. */
function fillRealms(ctx: EditionContext, state: LedgerState, realms: readonly number[], firstN: number): LedgerEvent[] {
  const occupancy = occupancyOf(ctx, state.settlers);
  const r = ctx.world.lattice.hamletRadius;
  const events: LedgerEvent[] = [];
  let ordinal = state.settlers.length;
  let n = firstN;
  for (const index of realms) {
    const circle = ctx.realms[index]!;
    const [minX, minY, maxX, maxY] = coastBox(ctx.world, circle.region);
    for (let j = Math.floor((minY * LATTICE.scale) / LATTICE.rowY); j <= Math.ceil((maxY * LATTICE.scale) / LATTICE.rowY); j++) {
      for (let i = Math.floor((minX * LATTICE.scale) / LATTICE.pitchX) - 1; i <= Math.ceil((maxX * LATTICE.scale) / LATTICE.pitchX); i++) {
        const p = latticePoint(i, j);
        if (!slotFits(ctx.land, occupancy, circle, p, r)) continue;
        occupancy.add(p.x, p.y, r);
        events.push({
          kind: 'settle', reason: 'candidate', path: 'realm', revision: rev1.manifest.revision,
          settler: { ordinal: ordinal++, kingdomId: synthId(n++) as AtlasSettler['kingdomId'], holdingId: slotHoldingId(i, j), realmIndex: index, holdingTier: 'hamlet', point: { x: p.x, y: p.y }, settledAt: ASOF1 },
        });
      }
    }
  }
  return events;
}

describe('when land runs out', () => {
  const crowd = revision({
    asOf: at(24), tag: 'crowd',
    specs: [...BASE, ...newcomers(3001, 'fr', [30, 70]), ...newcomers(3003, 'nl', [40]), ...newcomers(3004, 'de', [35])],
  });

  it('settles a newcomer whose realm is full on the Outer Isles', () => {
    const chain = start(d0, '0');
    const fr = realmOfLanguage(d0.world, 'fr');
    const filled = extendLedger(chain.state, fillRealms(chain.ctx, chain.state, [fr], 100_000));
    expect(filled.next.settlers.length - chain.state.settlers.length).toBe(d0.world.realms[fr]!.slots);
    const { result, chain: after } = night({ ...chain, state: filled.next, text: chain.text + filled.text, heads: [...chain.heads, headOf(filled.next, rev1.manifest.revision)] }, crowd);
    expect(result.summary).toMatchObject({ settled: 4, outer: 3, deferred: 0 });
    for (const event of settles(result)) {
      const n = nOf(event.settler.kingdomId);
      expect(event.path).toBe(n === 3004 ? 'realm' : 'outer');
      expect(d0.world.realms[event.settler.realmIndex]!.kind).toBe(n === 3004 ? 'isle' : 'outer');
      expect(slotProblems(after.ctx, event.settler, after.state.settlers)).toEqual([]);
    }
    expect(verifyEdition(filesOf(after), null).problems).toEqual([]);
  });

  it('defers eligible channels when their realm and the Outer Isles are full, and never gives them occupied land', () => {
    const chain = start(d0, '0');
    const fr = realmOfLanguage(d0.world, 'fr');
    const outer = d0.world.realms.filter((realm) => realm.kind === 'outer').map((realm) => realm.index);
    expect(outer.length).toBe(6);
    const filled = extendLedger(chain.state, fillRealms(chain.ctx, chain.state, [fr, ...outer], 100_000));
    const capacity = realmCapacity(chain.ctx.land, occupancyOf(chain.ctx, filled.next.settlers), { minY: d0.world.bounds.minY / 20, maxY: d0.world.bounds.maxY / 20 }, d0.world.lattice.hamletRadius);
    for (const index of [fr, ...outer]) expect(capacity.get(index) ?? 0).toBe(0);

    const ready: Chain = { ...chain, state: filled.next, text: chain.text + filled.text, heads: [...chain.heads, headOf(filled.next, rev1.manifest.revision)] };
    const { result, chain: after } = night(ready, crowd);
    // Two fr and one nl newcomer have nowhere to go; the de newcomer still settles at home.
    expect(result.summary).toEqual({ settled: 1, byRaid: 0, outer: 0, tombstones: 0, restores: 0, deferred: 3, unseenRaidTargets: 0 });
    expect(settles(result).map((event) => nOf(event.settler.kingdomId))).toEqual([3004]);
    expect(result.events.at(-1)).toMatchObject({ kind: 'night', settled: 1, deferred: 3 });
    for (const n of [3001, 3002, 3003]) expect(after.state.owners.has(synthId(n))).toBe(false);
    expect(verifyEdition(filesOf(after), null).problems).toEqual([]);
  }, 30_000);
});

// ── 5. Hide and gone ──────────────────────────────────────────────────────────────────────────────────────────

describe('hidden and gone channels', () => {
  it('tombstones, keeps and restores land; absence from a revision changes nothing', () => {
    const [hidden, gone, absent] = [d0.settlers[3]!, d0.settlers[5]!, d0.settlers[7]!];
    const withheldNewcomer = 2001;
    const goneAt = at(20);
    const specs = (opts: { goneAt?: number | null; dropGone?: boolean; withNewcomer?: boolean }) => [
      ...BASE.filter((spec) => spec.n !== nOf(absent.kingdomId) && !(opts.dropGone && spec.n === nOf(gone.kingdomId)))
        .map((spec) => (spec.n === nOf(gone.kingdomId) ? { ...spec, goneAt: opts.goneAt ?? null } : spec)),
      ...(opts.withNewcomer ? newcomers(withheldNewcomer, 'de', [90]) : []),
    ];

    // Night 2: one channel hidden, one gone, one missing from the survey, a withheld newcomer.
    const r2 = revision({ asOf: at(24), specs: specs({ goneAt, withNewcomer: true }), tag: 'hide' });
    const n2 = night(start(d0, '0'), r2, new Set([hidden.kingdomId, synthId(withheldNewcomer)]));
    expect(n2.result.events.filter((event) => event.kind !== 'night')).toEqual([
      { kind: 'tombstone', kingdomId: hidden.kingdomId, holdingId: hidden.holdingId, cause: 'hidden', at: r2.manifest.asOf, revision: r2.manifest.revision },
      { kind: 'tombstone', kingdomId: gone.kingdomId, holdingId: gone.holdingId, cause: 'gone', at: goneAt, revision: r2.manifest.revision },
    ].sort((a, b) => a.kingdomId.length - b.kingdomId.length || (a.kingdomId < b.kingdomId ? -1 : 1)));
    const s2 = n2.chain.state;
    // The holdings stay with their owners, and their land stays occupied for everyone else.
    expect(s2.settlers).toEqual(d0.settlers);
    const occupancy = occupancyOf(n2.chain.ctx, s2.settlers);
    for (const settler of [hidden, gone]) {
      expect(s2.owners.get(settler.kingdomId)).toBe(settler.ordinal);
      expect(occupancy.fits(settler.point.x, settler.point.y, d0.world.lattice.hamletRadius)).toBe(false);
    }
    expect(s2.tombstones.get(hidden.kingdomId)).toEqual({ cause: 'hidden', at: r2.manifest.asOf });
    expect(s2.tombstones.get(gone.kingdomId)).toEqual({ cause: 'gone', at: goneAt });
    expect(s2.tombstones.has(absent.kingdomId)).toBe(false);
    expect(s2.owners.has(synthId(withheldNewcomer))).toBe(false);

    // How the land is drawn.
    expect(holdingState(undefined, at(30))).toBe('active');
    expect(holdingState(s2.tombstones.get(hidden.kingdomId), at(25))).toBe('waiting');
    expect(holdingState(s2.tombstones.get(gone.kingdomId), goneAt)).toBe('abandoned');
    expect(holdingState(s2.tombstones.get(gone.kingdomId), goneAt + GONE_RETURN_MS - 1)).toBe('abandoned');
    expect(holdingState(s2.tombstones.get(gone.kingdomId), goneAt + GONE_RETURN_MS)).toBe('waiting');
    expect(GONE_RETURN_MS).toBe(30 * DAY);

    // Night 3: no longer withheld, the gone channel is absent: the hidden one returns, the gone one stays gone, and
    // the formerly withheld newcomer settles.
    const r3 = revision({ asOf: at(48), specs: specs({ dropGone: true, withNewcomer: true }), tag: 'unhide' });
    const n3 = night(n2.chain, r3);
    expect(n3.result.events.filter((event) => event.kind === 'restore' || event.kind === 'tombstone')).toEqual([
      { kind: 'restore', kingdomId: hidden.kingdomId, holdingId: hidden.holdingId, at: r3.manifest.asOf, revision: r3.manifest.revision },
    ]);
    expect(settles(n3.result).map((event) => nOf(event.settler.kingdomId))).toEqual([withheldNewcomer]);
    expect([...n3.chain.state.tombstones.keys()]).toEqual([gone.kingdomId]);

    // Night 4: the gone channel is found again and comes back to the same holding.
    const r4 = revision({ asOf: at(72), specs: specs({ withNewcomer: true }), tag: 'back' });
    const n4 = night(n3.chain, r4);
    expect(n4.result.events.filter((event) => event.kind !== 'night')).toEqual([
      { kind: 'restore', kingdomId: gone.kingdomId, holdingId: gone.holdingId, at: r4.manifest.asOf, revision: r4.manifest.revision },
    ]);
    expect(n4.chain.state.tombstones.size).toBe(0);
    expect(n4.chain.state.settlers.slice(0, d0.settlers.length)).toEqual(d0.settlers);

    const report = verifyEdition(filesOf(n4.chain), null);
    expect(report.problems).toEqual([]);
    expect(report.stats).toMatchObject({ nights: 4, tombstoned: 0 });
    expect(n4.result.summary).toMatchObject({ tombstones: 0, restores: 1 });

    // A tombstone must name the channel's own holding, and cannot be laid twice.
    const s = replayLedger(n2.chain.text, d0.edition);
    const tomb = (kingdomId: string, holdingId: string) => LedgerLineSchema.parse({ seq: s.lines, prev: s.head, kind: 'tombstone', kingdomId, holdingId, cause: 'hidden', at: at(30), revision: r2.manifest.revision });
    expect(() => applyEvent(s, tomb(hidden.kingdomId, hidden.holdingId))).toThrow(/already tombstoned/);
    expect(() => applyEvent(s, tomb(absent.kingdomId, hidden.holdingId))).toThrow(/does not name its holding/);
  });

  it('keeps a hidden holding waiting while its channel is missing from the survey, and restores it only when observed', () => {
    const hidden = d0.settlers[3]!;
    const without = BASE.filter((spec) => spec.n !== nOf(hidden.kingdomId));
    const r2 = revision({ asOf: at(24), specs: BASE, tag: 'hide' });
    const n2 = night(start(d0, '0'), r2, new Set([hidden.kingdomId]));
    expect(n2.chain.state.tombstones.get(hidden.kingdomId)).toEqual({ cause: 'hidden', at: r2.manifest.asOf });

    // Off the withheld list but not in the sweep: it may have been deleted, banned or hidden again. No restore.
    const r3 = revision({ asOf: at(48), specs: without, tag: 'unlisted-absent' });
    const n3 = night(n2.chain, r3);
    expect(n3.result.events.filter((event) => event.kind !== 'night')).toEqual([]);
    expect(n3.result.summary).toMatchObject({ tombstones: 0, restores: 0 });
    expect(n3.chain.state.tombstones.get(hidden.kingdomId)).toEqual({ cause: 'hidden', at: r2.manifest.asOf });
    // It still holds its land, so nobody else can be granted it.
    expect(n3.chain.state.owners.get(hidden.kingdomId)).toBe(hidden.ordinal);

    // Observed again, not withheld, not gone: the same holding comes back.
    const r4 = revision({ asOf: at(72), specs: BASE, tag: 'observed' });
    const n4 = night(n3.chain, r4);
    expect(n4.result.events.filter((event) => event.kind !== 'night')).toEqual([
      { kind: 'restore', kingdomId: hidden.kingdomId, holdingId: hidden.holdingId, at: r4.manifest.asOf, revision: r4.manifest.revision },
    ]);
    expect(n4.chain.state.settlers).toEqual(d0.settlers);
    expect(verifyEdition(filesOf(n4.chain), null).problems).toEqual([]);
  });
});

// ── 7. Out of order ───────────────────────────────────────────────────────────────────────────────────────────

describe('an out-of-order revision', () => {
  it('is refused and changes nothing', () => {
    const chain = start(d0, '0');
    const { chain: after } = night(chain, rev2);
    const snapshot = { lines: after.state.lines, head: after.state.head, settlers: after.state.settlers.length, lastNight: after.state.lastNight };
    const same = revision({ asOf: rev2.manifest.asOf, specs: REV2_SPECS, tag: 'same-time' });
    const older = revision({ asOf: at(12), specs: [...REV2_SPECS, ...newcomers(4100, 'de', [99])], tag: 'older' });
    expect(() => night(after, same)).toThrow(/is not newer than the last settled/);
    expect(() => night(after, older)).toThrow(/is not newer than the last settled/);
    expect(() => night(chain, revision({ asOf: ASOF1, specs: BASE, tag: 'founding-again' }))).toThrow(/is not newer/);
    expect({ lines: after.state.lines, head: after.state.head, settlers: after.state.settlers.length, lastNight: after.state.lastNight }).toEqual(snapshot);
    // The ledger enforces it too: an older night line cannot be appended.
    const stale: LedgerEvent = { kind: 'night', revision: older.manifest.revision, asOf: older.manifest.asOf, settled: 0, byRaid: 0, outer: 0, tombstones: 0, restores: 0, deferred: 0 };
    expect(() => extendLedger(after.state, [stale])).toThrow(/is not later than/);
    expect(after.state.lines).toBe(snapshot.lines);
  });
});

// ── 8. Land by raid ───────────────────────────────────────────────────────────────────────────────────────────

describe('land by raid', () => {
  const raider = () => nOf(d0.settlers[2]!.kingdomId);
  const raided = () => nOf(d0.settlers[9]!.kingdomId);
  // 5001–5004 are small observed streams; 5009 was never observed by a sweep.
  const raidRevision = (asOf: number, since: number, raids: (from: number, to: number, observedAt: number) => ReturnType<typeof raid>[]) => revision({
    asOf, tag: `raid-${asOf}`,
    specs: [...BASE, ...newcomers(5001, 'de', [10, 12, 14]), ...newcomers(5004, 'ja', [8])],
    raids: raids(raider(), raided(), since),
  });
  const RAIDS = (from: number, to: number, since: number) => [
    raid(from, 5001, since + 2 * HOUR), // granted from Edition I
    raid(from, 5009, since + 3 * HOUR), // unseen target: counted, nothing granted
    raid(from, 5002, since - HOUR), // before the last night
    raid(from, 5003, at(24) + 5_000), // after the database read
    raid(5004, 5002, since + 2 * HOUR), // from a channel without land
    raid(from, to, since + 4 * HOUR), // into a settled kingdom
  ];

  it('grants nothing under Edition 0 rules', () => {
    const rev = raidRevision(at(24), ASOF1, RAIDS);
    const { result } = night(start(d0, '0'), rev);
    expect(EDITIONS['0'].landByRaid).toBe(false);
    expect(settles(result)).toEqual([]);
    expect(result.summary).toMatchObject({ settled: 0, byRaid: 0 });
  });

  it('grants an observed small target a hamlet under Edition I, and counts an unseen one', () => {
    const rev = raidRevision(at(24), ASOF1, RAIDS);
    const { result, chain } = night(start(dI, 'I'), rev);
    expect(result.summary).toEqual({ settled: 1, byRaid: 1, outer: 0, tombstones: 0, restores: 0, deferred: 0, unseenRaidTargets: 1 });
    const [granted] = settles(result);
    expect(granted).toMatchObject({
      reason: 'raid', path: 'realm', revision: rev.manifest.revision,
      settler: { kingdomId: synthId(5001), holdingTier: 'hamlet', realmIndex: realmOfLanguage(dI.world, 'de'), settledAt: rev.manifest.asOf, ordinal: dI.settlers.length },
    });
    expect(slotProblems(chain.ctx, granted!.settler, chain.state.settlers)).toEqual([]);
    expect(chain.state.owners.has(synthId(5009))).toBe(false);
    const report = verifyEdition(filesOf(chain), null);
    expect(report.problems).toEqual([]);
    expect(report.stats.byReason).toEqual({ founding: 88, raid: 1 });
  });

  it('grants nothing to a raid from a hidden kingdom', () => {
    const hide = revision({ asOf: at(24), specs: BASE, tag: 'raider-hidden' });
    const first = night(start(dI, 'I'), hide, new Set([synthId(raider())]));
    const rev = raidRevision(at(48), at(24), (from, to, since) => [raid(from, 5001, since + HOUR), raid(to, 5002, since + HOUR)]);
    const { result } = night(first.chain, rev, new Set([synthId(raider())]));
    expect(settles(result).map((event) => [nOf(event.settler.kingdomId), event.reason])).toEqual([[5002, 'raid']]);
  });

  it('grants nothing to a raid from a kingdom hidden in the same night', () => {
    const rev = raidRevision(at(24), ASOF1, (from, _to, since) => [raid(from, 5001, since + HOUR)]);
    const { result } = night(start(dI, 'I'), rev, new Set([synthId(raider())]));
    expect(settles(result)).toEqual([]);
    expect(result.summary).toMatchObject({ tombstones: 1, byRaid: 0 });
  });

  it('counts an unseen raid target once however often it was raided', () => {
    const rev = raidRevision(at(24), ASOF1, (from, to, since) => [raid(from, 5009, since + HOUR), raid(from, 5009, since + 2 * HOUR), raid(to, 5009, since + 3 * HOUR)]);
    const { result } = night(start(dI, 'I'), rev);
    expect(result.summary).toMatchObject({ byRaid: 0, unseenRaidTargets: 1 });
  });

  it('is flagged by verification when a raid grant appears in Edition 0', () => {
    const rev = raidRevision(at(24), ASOF1, RAIDS);
    const { chain } = night({ ...start(d0, '0'), number: 'I' }, rev);
    expect(verifyEdition(filesOf(chain), null).problems).toEqual([`${synthId(5001)} was granted land by raid before Edition I.`]);
  });
});

// ── 9. Founding gates ─────────────────────────────────────────────────────────────────────────────────────────

describe('founding gates', () => {
  const NOW = T0 + 8 * DAY;
  const keys = testKeys();
  const stranger = testKeys();
  const key = founderKey(keys.publicPem);
  const m48 = revision({ asOf: T0 + 48 * HOUR, specs: [], tag: 'gate-48' }).manifest;
  const m48short = revision({ asOf: T0 + 48 * HOUR - 1, specs: [], tag: 'gate-48-short' }).manifest;
  const m7d = revision({ asOf: T0 + 7 * DAY, specs: [], tag: 'gate-7d' }).manifest;
  const m7dShort = revision({ asOf: T0 + 7 * DAY - 1, specs: [], tag: 'gate-7d-short' }).manifest;
  const reviewedText = (() => {
    const taxonomy = JSON.parse(TAXONOMY) as { review: Record<string, unknown> };
    taxonomy.review = { ...taxonomy.review, status: 'reviewed', reviewedBy: 'test_reviewer', reviewedAt: '2026-11-06' };
    return `${JSON.stringify(taxonomy, null, 2)}\n`;
  })();
  const reviewed = loadTaxonomy(reviewedText).ref;

  const payload = (over: Partial<AuthorizationPayload> = {}): AuthorizationPayload => ({
    kind: 'chatdom-atlas-founding-authorization', edition: '0', revision: m48.revision, taxonomySha256: TAXONOMY_REF.sha256,
    issuedAt: NOW - HOUR, issuedBy: 'test_founder', ...over,
  });
  const signed = (over: Partial<AuthorizationPayload> = {}, pem = keys.privatePem) => signAuthorization(payload(over), pem);
  const gates = (over: Partial<FoundingGateInput> = {}) => foundingGates({
    number: '0', manifest: m48, taxonomy: TAXONOMY_REF, authorization: signed(), founderKey: key.key, existing: false, now: NOW, ...over,
  });

  it('passes Edition 0 at exactly 48 hours with a proposed taxonomy and a valid authorization', () => {
    expect(TAXONOMY_REF.status).toBe('proposed');
    expect(gates()).toEqual([]);
  });

  it('passes Edition I at exactly 7 days with a reviewed taxonomy', () => {
    expect(gates({ number: 'I', manifest: m7d, taxonomy: reviewed, authorization: signed({ edition: 'I', revision: m7d.revision, taxonomySha256: reviewed.sha256 }) })).toEqual([]);
  });

  it('refuses each missing or mismatched condition on its own', () => {
    const cases: [Partial<FoundingGateInput>, RegExp][] = [
      [{ manifest: m48short, authorization: signed({ revision: m48short.revision }) }, /^Edition 0 needs 48\.0 h of observations/],
      [{ number: 'I', manifest: m7dShort, taxonomy: reviewed, authorization: signed({ edition: 'I', revision: m7dShort.revision, taxonomySha256: reviewed.sha256 }) }, /^Edition I needs 168\.0 h of observations/],
      [{ number: 'I', manifest: m7d, authorization: signed({ edition: 'I', revision: m7d.revision }) }, /^Edition I needs a reviewed family taxonomy; families-1 is still a proposal/],
      [{ existing: true }, /already founded/],
      [{ founderKey: null }, /^No founder key is configured/],
      [{ authorization: null }, /^No founder authorization was given/],
      [{ authorization: signed({ edition: 'I' }) }, /^The authorization is for Edition I, not Edition 0/],
      [{ authorization: signed({ revision: m7d.revision }) }, /^The authorization names revision obs-/],
      [{ authorization: signed({ taxonomySha256: reviewed.sha256 }) }, /different family taxonomy bytes/],
      [{ authorization: signed({ issuedAt: NOW + 1 }) }, /dated in the future/],
      [{ authorization: signed({}, stranger.privatePem) }, /signature does not verify/],
      [{ authorization: { ...signed(), payload: payload({ issuedBy: 'someone_else' }) } }, /signature does not verify/],
    ];
    for (const [over, reason] of cases) {
      const problems = gates(over);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(reason);
    }
  });

  it('reports every reason together', () => {
    const problems = gates({
      number: 'I', manifest: m48, existing: true,
      authorization: signed({ edition: '0', revision: m7d.revision, taxonomySha256: reviewed.sha256, issuedAt: NOW + DAY }, stranger.privatePem),
    });
    expect(problems).toHaveLength(8);
    for (const reason of [/already founded/, /needs 168\.0 h/, /reviewed family taxonomy/, /for Edition 0, not Edition I/, /names revision/, /taxonomy bytes/, /future/, /does not verify/]) {
      expect(problems.some((problem) => reason.test(problem))).toBe(true);
    }
  });

  it('signs canonical payloads with Ed25519 and accepts only an Ed25519 founder key', () => {
    const authorization = signed();
    expect(verifyAuthorization(authorization, key.key)).toBe(true);
    expect(verifyAuthorization(authorization, founderKey(stranger.publicPem).key)).toBe(false);
    // Key order in the stored payload does not matter: the signature covers the canonical form.
    const { issuedBy, ...rest } = authorization.payload;
    expect(verifyAuthorization({ ...authorization, payload: { issuedBy, ...rest } }, key.key)).toBe(true);
    expect(key.fingerprint).toBe(sha(key.key.export({ type: 'spki', format: 'der' })));
    expect(() => founderKey(x25519PublicKey())).toThrow(/Ed25519/);
  });
});

// ── 9b. The founding command on a temp data directory ─────────────────────────────────────────────────────────

describe('atlas:found on a temp data directory', () => {
  const cleanup: (() => void)[] = [];
  afterAll(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  function scratch(): { dataDir: string; keyDir: string } {
    const dataDir = tempDataDir();
    const keyDir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-test-key-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => rmSync(keyDir, { recursive: true, force: true }));
    return { dataDir, keyDir };
  }

  async function importFrom(source: FixtureSource, dataDir: string, now: number) {
    const { fetchImpl } = fakeSurveyor({ status: source.status(), 'raids/recent': [] });
    const outcome = await runImport(configFor(source, dataDir), { fetchImpl, now: clock(now), sleep: async () => {} });
    if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
    return outcome;
  }

  const foundings = (dataDir: string) => readFileSync(join(dataDir, FOUNDINGS_LOG), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { outcome: string; edition: string; revision: string; problems: string[] });

  function authorize(dataDir: string, keyDir: string, number: EditionNumber, privatePem: string, now: number): string {
    const keyPath = join(keyDir, 'founder-test.pem');
    writeFileSync(keyPath, privatePem, { mode: 0o600 });
    const authorization = runAuthorize(dataDir, number, keyPath, 'test_founder', now);
    const path = join(keyDir, `authorization-${number}-${now}.json`);
    writeFileSync(path, JSON.stringify(authorization));
    return path;
  }

  it('refuses a survey under 48 hours, writes nothing under editions/, and logs the refusal', async () => {
    const source = FixtureSource.standard();
    cleanup.push(() => source.close());
    const { dataDir, keyDir } = scratch();
    const imported = await importFrom(source, dataDir, sweepAt(10));
    const keys = testKeys();

    const bare = runFound(dataDir, '0', null, null, sweepAt(20));
    expect(bare).toMatchObject({ ok: false, edition: 'ed-0', revision: imported.revision });
    expect(bare.problems).toEqual([
      expect.stringMatching(/^Edition 0 needs 48\.0 h of observations; this survey has 0\.2 h/),
      expect.stringMatching(/^No founder key/),
      expect.stringMatching(/^No founder authorization/),
    ]);

    const authorization = authorize(dataDir, keyDir, '0', keys.privatePem, sweepAt(15));
    const signedButShort = runFound(dataDir, '0', authorization, keys.publicPem, sweepAt(20));
    expect(signedButShort.ok).toBe(false);
    expect(signedButShort.problems).toEqual([expect.stringMatching(/^Edition 0 needs 48\.0 h/)]);

    const editionI = runFound(dataDir, 'I', authorization, keys.publicPem, sweepAt(20));
    expect(editionI.problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Edition I needs 168\.0 h/), expect.stringMatching(/reviewed family taxonomy/), expect.stringMatching(/for Edition 0, not Edition I/),
    ]));

    expect(existsSync(join(dataDir, 'editions'))).toBe(false);
    expect(foundings(dataDir).map((entry) => [entry.outcome, entry.edition, entry.revision])).toEqual([
      ['rejected', 'ed-0', imported.revision], ['rejected', 'ed-0', imported.revision], ['rejected', 'ed-1', imported.revision],
    ]);
  });

  it('founds once on a ≥48 h synthetic survey, verifies, refuses a second founding, and appends settlement as a pure suffix', async () => {
    // Exactly 48 hours of sweeps (961 sweeps, 3 minutes apart), clearly fake channels.
    const source = new FixtureSource();
    cleanup.push(() => source.close());
    source.addSweeps(961);
    source.addChannel({ id: '900000000000000001', login: 'fixture_capital', name: 'Fixture Capital', firstSweep: 0, lastSweep: 960, live: true, liveMin: 2_400, viewerMin: 14_400_000 });
    source.addChannel({ id: '900000000000000002', login: 'fixture_town', name: 'Fixture Town', lang: 'ja', firstSweep: 0, lastSweep: 500, live: false, liveMin: 900, viewerMin: 54_000, game: ['21779', 'League of Legends'] });
    source.addChannel({ id: '900000000000000003', login: 'fixture_village', name: 'Fixture Village', lang: 'de', firstSweep: 1, lastSweep: 960, live: true, liveMin: 1_200, viewerMin: 36_000 });
    source.addChannel({ id: '900000000000000004', login: 'fixture_small', name: 'Fixture Small', firstSweep: 950, lastSweep: 960, live: true, liveMin: 30, viewerMin: 240 });
    const { dataDir, keyDir } = scratch();
    const first = await importFrom(source, dataDir, sweepAt(970));
    expect(first.manifest.founding.observedMs).toBe(48 * HOUR);

    const keys = testKeys();
    const authorization = authorize(dataDir, keyDir, '0', keys.privatePem, sweepAt(975));

    // An unreadable withheld list refuses the founding: hidden channels could not be tombstoned.
    const withheldPath = join(dataDir, WITHHELD_FILE);
    mkdirSync(join(dataDir, 'moderation'), { recursive: true });
    writeFileSync(withheldPath, '{"version":1,"updatedAt":');
    const blind = runFound(dataDir, '0', authorization, keys.publicPem, sweepAt(978));
    expect(blind).toMatchObject({ ok: false, edition: 'ed-0' });
    expect(blind.problems).toEqual([expect.stringMatching(/^The withheld list is unreadable, so hidden channels cannot be tombstoned/)]);
    expect(existsSync(join(dataDir, 'editions'))).toBe(false);

    // The town is withheld at founding: it holds its land under a hidden tombstone.
    const withheldText = JSON.stringify({ version: 1, updatedAt: sweepAt(979), kingdomIds: ['900000000000000002'] });
    writeFileSync(withheldPath, withheldText);
    const founded = runFound(dataDir, '0', authorization, keys.publicPem, sweepAt(980));
    expect(founded).toMatchObject({ ok: true, edition: 'ed-0', revision: first.revision, problems: [], settlers: 3 });
    const dir = editionDir(dataDir, 'ed-0');
    expect(readdirSync(dir).sort()).toEqual(['edition.json', 'founding.json', 'heads.ndjson', 'ledger.ndjson', 'taxonomy.json', 'world.json']);
    expect(readdirSync(join(dataDir, 'editions'))).toEqual(['ed-0']);
    expect(readFileSync(join(dir, 'taxonomy.json'), 'utf8')).toBe(TAXONOMY);
    const key = founderKey(keys.publicPem);
    const report = verifyEditionDir(dataDir, 'ed-0', key);
    expect(report.problems).toEqual([]);
    expect(report.edition?.worldHash).toBe(founded.worldHash);
    expect(sha(readFileSync(join(dir, 'world.json')))).toBe(founded.worldHash);
    expect(readEditionFiles(dataDir, 'ed-0').founding).toMatchObject({
      number: '0', revision: first.revision, founderKey: key.fingerprint, taxonomy: { status: 'proposed' }, settlers: 3,
      withheld: { key: `sha256:${sha(withheldText)}`, hidden: 1 },
    });
    expect([...report.state!.tombstones]).toEqual([['900000000000000002', { cause: 'hidden', at: first.manifest.asOf }]]);
    expect(report.stats).toMatchObject({ settlers: 3, tombstoned: 1, nights: 1 });
    // The record and the founding night must agree on what was hidden and settled.
    const recorded = readEditionFiles(dataDir, 'ed-0');
    const tampered = (founding: NonNullable<typeof recorded.founding>) => verifyEdition({ ...recorded, founding }, key).problems;
    expect(tampered({ ...recorded.founding!, withheld: { ...recorded.founding!.withheld, hidden: 0 } })).toEqual([expect.stringMatching(/records 0 withheld channels; the founding night tombstoned 1/)]);
    expect(tampered({ ...recorded.founding!, settlers: 4 })).toEqual([expect.stringMatching(/records 4 founding holdings; the ledger founded 3/)]);
    // Verification needs the founder's key, and that key alone.
    expect(verifyEditionDir(dataDir, 'ed-0', null).problems).toEqual([expect.stringMatching(/founder key is not configured/)]);
    expect(verifyEditionDir(dataDir, 'ed-0', founderKey(testKeys().publicPem)).problems).toEqual([expect.stringMatching(/does not verify against the founder key/)]);

    // Founded once.
    const ledgerBefore = readFileSync(join(dir, 'ledger.ndjson'));
    const again = runFound(dataDir, '0', authorization, keys.publicPem, sweepAt(985));
    expect(again.ok).toBe(false);
    expect(again.problems).toEqual([expect.stringMatching(/Edition 0 is already founded/)]);
    const files = readEditionFiles(dataDir, 'ed-0');
    const state = replayLedger(files.ledgerText, report.edition!);
    expect(() => writeNewEdition(dataDir, {
      id: 'ed-0', edition: files.edition, founding: files.founding!, worldBytes: files.worldBytes, taxonomyText: files.taxonomyText,
      ledgerText: files.ledgerText, state, now: sweepAt(986),
    }, key)).toThrow(/already exists; an edition is founded once/);
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerBefore)).toBe(true);
    expect(foundings(dataDir).map((entry) => entry.outcome)).toEqual(['rejected', 'founded', 'rejected']);

    // A stale writer is refused and leaves the ledger as it was.
    expect(() => appendSettlement(dataDir, 'ed-0', { files: { ...files, ledgerText: `${files.ledgerText}{}\n` }, text: '', next: state, revision: first.revision, now: sweepAt(987) }, key))
      .toThrow(/changed since it was read/);
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerBefore)).toBe(true);

    // A later survey with a newcomer: settlement appends, the old bytes stay an exact prefix.
    source.addSweeps(10);
    source.db.exec('UPDATE channels SET live = 0');
    source.addChannel({ id: '900000000000000005', login: 'fixture_newcomer', name: 'Fixture Newcomer', lang: 'de', firstSweep: 962, lastSweep: 965, live: false, liveMin: 30, viewerMin: 1_500 });
    const second = await importFrom(source, dataDir, sweepAt(990));
    expect(second.revision).not.toBe(first.revision);
    const settled = runSettle(dataDir, keys.publicPem, sweepAt(995));
    expect(settled).toMatchObject({ outcome: 'settled', edition: 'ed-0', revision: second.revision, settlers: 4, summary: { settled: 1, tombstones: 0, restores: 0, deferred: 0 } });
    const ledgerAfter = readFileSync(join(dir, 'ledger.ndjson'));
    expect(ledgerAfter.length).toBeGreaterThan(ledgerBefore.length);
    expect(ledgerAfter.subarray(0, ledgerBefore.length).equals(ledgerBefore)).toBe(true);
    expect(readFileSync(join(dir, 'heads.ndjson'), 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    expect(verifyEditionDir(dataDir, 'ed-0', key).problems).toEqual([]);
    expect(runSettle(dataDir, keys.publicPem, sweepAt(996))).toEqual({ outcome: 'up-to-date', edition: 'ed-0', revision: second.revision });
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerAfter)).toBe(true);

    // An append is verified as the edition it would make before the swap: land granted by an absent founded-record
    // producer, off the lattice and on top of a neighbour, is refused and the ledger and heads stay as they were.
    const settledFiles = readEditionFiles(dataDir, 'ed-0');
    const settledState = replayLedger(settledFiles.ledgerText, report.edition!);
    const neighbour = settledState.settlers[3]!;
    const bad = extendLedger(settledState, [{
      kind: 'settle', reason: 'founded', path: 'realm', revision: second.revision,
      settler: { ...neighbour, ordinal: settledState.settlers.length, kingdomId: '900000000000000099' as AtlasSettler['kingdomId'], holdingId: 's:9999:9999' },
    }]);
    const headsBefore = readFileSync(join(dir, 'heads.ndjson'));
    expect(() => appendSettlement(dataDir, 'ed-0', { files: settledFiles, text: bad.text, next: bad.next, revision: second.revision, now: sweepAt(997) }, key))
      .toThrow(/failed verification, so the ledger was not changed: .*no founded-record producer/);
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerAfter)).toBe(true);
    expect(readFileSync(join(dir, 'heads.ndjson')).equals(headsBefore)).toBe(true);
    expect(readdirSync(dir).filter((name) => name.startsWith('.'))).toEqual([]);
    // The same append verified against a key that is not the founder's is refused too.
    const good = extendLedger(settledState, [{ kind: 'tombstone', kingdomId: neighbour.kingdomId, holdingId: neighbour.holdingId, cause: 'hidden', at: sweepAt(997), revision: second.revision }]);
    expect(() => appendSettlement(dataDir, 'ed-0', { files: settledFiles, text: good.text, next: good.next, revision: second.revision, now: sweepAt(997) }, founderKey(testKeys().publicPem)))
      .toThrow(/failed verification.*does not verify against the founder key/);
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerAfter)).toBe(true);

    // Moderation does not wait for a new survey: the village is withheld with no newer revision, and this very run
    // tombstones its holding. Nothing else changes and nothing moves.
    const village = '900000000000000003';
    expect(settledState.owners.has(village) && !settledState.tombstones.has(village)).toBe(true);
    writeFileSync(withheldPath, JSON.stringify({ version: 1, updatedAt: sweepAt(998), kingdomIds: ['900000000000000002', village] }));
    const moderated = runSettle(dataDir, keys.publicPem, sweepAt(1000));
    expect(moderated).toEqual({ outcome: 'moderated', edition: 'ed-0', revision: second.revision, hidden: 1, settlers: 4 });
    const ledgerModerated = readFileSync(join(dir, 'ledger.ndjson'));
    expect(ledgerModerated.subarray(0, ledgerAfter.length).equals(ledgerAfter)).toBe(true);
    const afterModeration = verifyEditionDir(dataDir, 'ed-0', key);
    expect(afterModeration.problems).toEqual([]);
    expect(afterModeration.state!.tombstones.get(village)).toEqual({ cause: 'hidden', at: sweepAt(1000) });
    expect(afterModeration.state!.settlers).toEqual(settledState.settlers);
    expect(afterModeration.state!.lastNight).toEqual(settledState.lastNight);
    expect(readFileSync(join(dir, 'heads.ndjson'), 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    // Already hidden: the next run has nothing to add.
    expect(runSettle(dataDir, keys.publicPem, sweepAt(1001))).toEqual({ outcome: 'up-to-date', edition: 'ed-0', revision: second.revision });
    // Taken off the list without a fresh sweep, the land keeps waiting: only an observed revision restores it.
    writeFileSync(withheldPath, JSON.stringify({ version: 1, updatedAt: sweepAt(1002), kingdomIds: ['900000000000000002'] }));
    expect(runSettle(dataDir, keys.publicPem, sweepAt(1003))).toEqual({ outcome: 'up-to-date', edition: 'ed-0', revision: second.revision });
    expect(verifyEditionDir(dataDir, 'ed-0', key).state!.tombstones.has(village)).toBe(true);
    // An unreadable list refuses the run even without a newer revision; nothing is written.
    writeFileSync(withheldPath, '{"version":1,');
    expect(() => runSettle(dataDir, keys.publicPem, sweepAt(1004))).toThrow(/withheld list is unreadable/);
    expect(readFileSync(join(dir, 'ledger.ndjson')).equals(ledgerModerated)).toBe(true);
  }, 30_000);
});
