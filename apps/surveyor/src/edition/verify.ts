import type { KeyObject } from 'node:crypto';
import { AtlasEditionSchema, type AtlasEdition } from '@chatdom/shared';
import { sha256 } from '../export/project';
import { loadTaxonomy } from '../cartography/taxonomy';
import { LATTICE, latticePoint, parseSlotHoldingId } from '../cartography/slots';
import { verifyAuthorization } from './authorization';
import { headHolds, replayLedger, type LedgerState } from './ledger';
import { editionContext, holdingRadius } from './settle';
import { EDITIONS, EditionWorldSchema, LedgerLineSchema, type EditionWorld, type Founding, type LedgerHead } from './schema';

export interface EditionFiles {
  edition: unknown;
  worldBytes: Uint8Array;
  taxonomyText: string;
  ledgerText: string;
  heads: readonly LedgerHead[];
  founding: Founding | null;
  /** founding.json exactly as stored: part of the edition's content address. */
  foundingBytes?: Uint8Array;
}

export interface VerifyOptions {
  /** A bench started with ATLAS_REHEARSAL=1 may serve and settle a rehearsal; nothing else may. */
  allowRehearsal?: boolean;
}

export interface EditionReport {
  problems: string[];
  edition: AtlasEdition | null;
  world: EditionWorld | null;
  state: LedgerState | null;
  stats: { settlers: number; byReason: Record<string, number>; outer: number; tombstoned: number; nights: number; heads: number };
}

const MAX = 20;

/**
 * Proves an edition's invariants (R3): the world hash, the taxonomy it was drawn with, an unbroken append-only ledger
 * with one owner per holding and one holding per channel, every holding on dry land in its own realm without
 * overlap, slot holdings exactly on the hamlet lattice, every acknowledged head still a prefix (no earlier address
 * changed), no founded record without its producer, and the founding gates and signature.
 */
export function verifyEdition(files: EditionFiles, founderKey: { key: KeyObject; fingerprint: string } | null, options: VerifyOptions = {}): EditionReport {
  const problems: string[] = [];
  const add = (problem: string) => {
    if (problems.length < MAX) problems.push(problem);
  };
  const stats: EditionReport['stats'] = { settlers: 0, byReason: {}, outer: 0, tombstoned: 0, nights: 0, heads: files.heads.length };
  const fail = (problem: string): EditionReport => {
    add(problem);
    return { problems, edition: null, world: null, state: null, stats };
  };
  const parsedEdition = AtlasEditionSchema.safeParse(files.edition);
  if (!parsedEdition.success) return fail('edition.json is not a valid AtlasEdition.');
  const edition = parsedEdition.data;
  if (edition.status !== 'frozen') add('an official edition must be frozen.');
  if (sha256(files.worldBytes) !== edition.worldHash) return fail('world.json does not match the edition world hash: frozen land changed.');
  let world: EditionWorld;
  try {
    world = EditionWorldSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.worldBytes)));
  } catch {
    return fail('world.json is not a valid edition world.');
  }
  if (world.edition !== edition.id) add('world.json belongs to another edition.');
  if (world.realms.length !== edition.realmCount) add('the edition realm count differs from its world.');
  let taxonomy;
  try {
    taxonomy = loadTaxonomy(files.taxonomyText);
  } catch {
    return fail('taxonomy.json is not a valid family taxonomy.');
  }
  if (taxonomy.ref.sha256 !== world.taxonomy.sha256) add('taxonomy.json is not the taxonomy the world was drawn with.');

  let state: LedgerState;
  try {
    state = replayLedger(files.ledgerText, edition);
  } catch (error) {
    add(`ledger: ${error instanceof Error ? error.message : String(error)}`);
    return { problems, edition, world, state: null, stats };
  }
  for (const head of files.heads) if (!headHolds(files.ledgerText, head)) add(`acknowledged head at ${head.lines} lines (${head.revision}) is no longer a prefix: an earlier address changed.`);
  const last = files.heads[files.heads.length - 1];
  if (!last || last.lines !== state.lines || last.head !== state.head) add('the ledger has lines no head acknowledges (an interrupted settlement); run atlas:settle to acknowledge or investigate.');

  /** What the founding itself wrote, up to its night: settlements and the hidden tombstones of withheld channels. */
  const founded = { settles: 0, hidden: 0, other: 0 };
  for (const raw of files.ledgerText.split('\n')) {
    if (!raw) continue;
    const line = LedgerLineSchema.parse(JSON.parse(raw));
    if (stats.nights === 0) {
      if (line.kind === 'settle' && line.reason === 'founding') founded.settles++;
      else if (line.kind === 'tombstone' && line.cause === 'hidden') founded.hidden++;
      else if (line.kind !== 'night') founded.other++;
    } else if (line.kind === 'settle' && line.reason === 'founding') add(`${line.settler.kingdomId} was settled as founding after the founding night.`);
    if (line.kind === 'night') stats.nights++;
    if (line.kind !== 'settle') continue;
    stats.byReason[line.reason] = (stats.byReason[line.reason] ?? 0) + 1;
    if (line.path === 'outer') stats.outer++;
    if ((line.reason === 'raid' || line.reason === 'founded' || line.reason === 'signed-in') && !EDITIONS[editionNumber(edition.id)].landByRaid) {
      add(`${line.settler.kingdomId} was granted land by ${line.reason === 'raid' ? 'raid' : 'claim'} before Edition I.`);
    }
    if (line.reason === 'founding' && line.settler.holdingId !== `f:${line.settler.ordinal}`) add(`founding holding ${line.settler.holdingId} is not named by its ordinal.`);
    if (line.reason !== 'founding' && !parseSlotHoldingId(line.settler.holdingId)) add(`settled holding ${line.settler.holdingId} is not a hamlet-lattice slot.`);
  }
  stats.settlers = state.settlers.length;
  stats.tombstoned = state.tombstones.size;

  // Land: every holding on its realm's land, slot holdings on the lattice with a shore, no two holdings overlapping.
  const ctx = editionContext(world, taxonomy);
  let wet = 0;
  let foreign = 0;
  for (const settler of state.settlers) {
    const realm = world.realms[settler.realmIndex];
    if (!realm) {
      add(`${settler.kingdomId} names unknown realm ${settler.realmIndex}.`);
      continue;
    }
    const region = ctx.land.regionAt(settler.point.x, settler.point.y);
    if (region < 0) wet++;
    else if (region !== realm.region) foreign++;
    const slot = parseSlotHoldingId(settler.holdingId);
    if (!slot) continue;
    const point = latticePoint(slot.i, slot.j);
    if (point.x !== settler.point.x || point.y !== settler.point.y) add(`${settler.holdingId} does not stand on its lattice point.`);
    const r = holdingRadius(world, settler.holdingTier);
    if (ctx.land.realmAt(point.x, point.y) !== settler.realmIndex) add(`${settler.holdingId} lies outside realm ${settler.realmIndex}.`);
    if (ctx.land.distanceToCoast(point.x, point.y, r + LATTICE.shore) < r + LATTICE.shore - 1e-9) add(`${settler.holdingId} has no shore between it and the sea.`);
  }
  if (wet) add(`${wet} holdings stand in the sea.`);
  if (foreign) add(`${foreign} holdings stand on another region's land.`);
  const overlaps = countOverlaps(state, world);
  if (overlaps) add(`${overlaps} pairs of holdings overlap.`);

  if (files.founding) {
    const founding = files.founding;
    const rules = EDITIONS[founding.number];
    if (founding.edition !== edition.id || founding.revision !== world.revision) add('founding.json describes a different edition or revision.');
    // A rehearsal waived its gates on a bench; it is never valid anywhere else.
    const rehearsal = founding.rehearsal !== undefined;
    if (rehearsal && !options.allowRehearsal) add(`${rules.label} here is a rehearsal; it is served and settled only on a bench (ATLAS_REHEARSAL=1).`);
    if (!rehearsal) {
      if (founding.window.observedMs < rules.minObservedMs) add(`${rules.label} was founded on ${(founding.window.observedMs / 3_600_000).toFixed(1)} h of observations, below its minimum.`);
      if (rules.requiresReviewedTaxonomy && founding.taxonomy.status !== 'reviewed') add(`${rules.label} was founded on an unreviewed taxonomy.`);
      if (rules.requiresReviewedNames && founding.names?.status !== 'reviewed') add(`${rules.label} was founded without a reviewed continent name table.`);
    }
    // Foundings that record their name table also date the edition by the founder's signature (content addressing).
    if (founding.names !== undefined && edition.foundedAt !== founding.authorization.payload.issuedAt) add('the edition is not dated by its founder authorization.');
    if (founding.taxonomy.sha256 !== world.taxonomy.sha256) add('founding.json names different taxonomy bytes.');
    const payload = founding.authorization.payload;
    if (payload.edition !== founding.number || payload.revision !== founding.revision || payload.taxonomySha256 !== founding.taxonomy.sha256) add('the founding authorization names different land.');
    if (founding.settlers !== founded.settles) add(`founding.json records ${founding.settlers} founding holdings; the ledger founded ${founded.settles}.`);
    if (founding.withheld.hidden !== founded.hidden) add(`founding.json records ${founding.withheld.hidden} withheld channels; the founding night tombstoned ${founded.hidden}.`);
    if (founded.other) add('the founding night holds events other than founding settlements and hidden tombstones.');
    if (!founderKey) add('the founder key is not configured, so the founding authorization cannot be verified.');
    else if (founderKey.fingerprint !== founding.founderKey || !verifyAuthorization(founding.authorization, founderKey.key)) add('the founding authorization does not verify against the founder key.');
  }
  return { problems, edition, world, state, stats };
}

function editionNumber(id: string): '0' | 'I' {
  return id === 'ed-0' ? '0' : 'I';
}

function countOverlaps(state: LedgerState, world: EditionWorld): number {
  const cell = 16;
  const grid = new Map<string, number[]>();
  state.settlers.forEach((settler, index) => {
    const k = `${Math.floor(settler.point.x / cell)},${Math.floor(settler.point.y / cell)}`;
    const list = grid.get(k);
    if (list) list.push(index);
    else grid.set(k, [index]);
  });
  let overlaps = 0;
  state.settlers.forEach((a, i) => {
    const ra = holdingRadius(world, a.holdingTier);
    const cx = Math.floor(a.point.x / cell);
    const cy = Math.floor(a.point.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue;
          const b = state.settlers[j]!;
          const rb = holdingRadius(world, b.holdingTier);
          // Founding holdings were relaxed apart and quantised to 1/20 unit; a slot holding keeps the full gap.
          const founding = a.holdingId.startsWith('f:') && b.holdingId.startsWith('f:');
          const min = founding ? ra + rb - 0.1 : ra + rb + world.lattice.gap - 1e-6;
          if (Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) < min) overlaps++;
        }
      }
    }
  });
  return overlaps;
}
