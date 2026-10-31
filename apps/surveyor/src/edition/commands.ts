import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkRevisionDir, type RevisionRecords } from '../check';
import { AtlasError } from '../errors';
import { sha256 } from '../export/project';
import type { SnapshotManifest } from '../export/schema';
import { currentTaxonomyText, loadTaxonomy } from '../cartography/taxonomy';
import { WITHHELD_FILE, WithheldSchema } from '../policy/visibility';
import { layout, readCurrent, revisionDir } from '../store/revisions';
import { founderKey, signAuthorization } from './authorization';
import { draftEdition, foundingGates, foundingRecord } from './found';
import { extendLedger } from './ledger';
import { AuthorizationSchema, EDITIONS, type Authorization, type EditionNumber } from './schema';
import { editionContext, hideWithheld, settleNight, type NightResult } from './settle';
import { acknowledgeHead, appendFoundingLog, appendSettlement, listEditions, readEditionFiles, writeNewEdition } from './store';
import { verifyEdition, type EditionFiles, type EditionReport } from './verify';

/** A revision's verified records; a revision that fails its own check is never founded or settled from. */
export function readVerifiedRevision(dataDir: string, revision: string): { manifest: SnapshotManifest; records: RevisionRecords } {
  const report = checkRevisionDir(revisionDir(dataDir, revision));
  if (!report.ok || !report.manifest || !report.records) throw new AtlasError('check', `Revision ${revision} failed verification.`, report.problems);
  return { manifest: report.manifest, records: report.records };
}

function currentRevision(dataDir: string): string {
  const pointer = readCurrent(dataDir);
  if (!pointer) throw new AtlasError('inventory-missing', 'No imported revision yet. Run atlas:import first.');
  return pointer.revision;
}

const keyFrom = (pem: string | null) => (pem ? founderKey(pem) : null);

/**
 * The withheld list exactly as a founding reads it: one read of the file, its IDs and a content key (`none` when
 * there is no list). Unlike the serving reader it never falls back to an earlier set; an unreadable list is an error.
 */
export function readWithheldList(dataDir: string): { ids: ReadonlySet<string>; key: string } | { error: string } {
  const path = join(dataDir, WITHHELD_FILE);
  if (!existsSync(path)) return { ids: new Set(), key: 'none' };
  try {
    const bytes = readFileSync(path);
    const parsed = WithheldSchema.parse(JSON.parse(bytes.toString('utf8')));
    return { ids: new Set(parsed.kingdomIds), key: `sha256:${sha256(bytes)}` };
  } catch (failure) {
    return { error: `withheld list unreadable: ${failure instanceof Error ? failure.message.slice(0, 160) : String(failure)}` };
  }
}

export interface FoundResult { ok: boolean; edition: string; revision: string | null; problems: string[]; settlers?: number; worldHash?: string }

/**
 * The official founding command. Every gate is checked before anything is drawn; a refusal is logged in
 * ledger/foundings.ndjson and changes nothing else.
 */
export function runFound(dataDir: string, number: EditionNumber, authorizationPath: string | null, founderKeyPem: string | null, now: number): FoundResult {
  const rules = EDITIONS[number];
  const revision = currentRevision(dataDir);
  const { manifest, records } = readVerifiedRevision(dataDir, revision);
  const taxonomyText = currentTaxonomyText();
  const taxonomy = loadTaxonomy(taxonomyText).ref;
  let authorization: Authorization | null = null;
  const problems: string[] = [];
  if (authorizationPath) {
    try {
      authorization = AuthorizationSchema.parse(JSON.parse(readFileSync(authorizationPath, 'utf8')));
    } catch {
      problems.push('The authorization file is unreadable or not a founding authorization.');
    }
  }
  let key = null;
  try {
    key = keyFrom(founderKeyPem);
  } catch {
    problems.push('ATLAS_FOUNDER_PUBLIC_KEY is not an Ed25519 public key.');
  }
  const withheld = readWithheldList(dataDir);
  if ('error' in withheld) problems.push(`The withheld list is unreadable, so hidden channels cannot be tombstoned (${withheld.error}).`);
  problems.push(...foundingGates({
    number, manifest, taxonomy, authorization, founderKey: key?.key ?? null,
    existing: listEditions(dataDir).includes(rules.id), now,
  }));
  if (problems.length || !authorization || !key || 'error' in withheld) {
    appendFoundingLog(dataDir, { at: now, edition: rules.id, outcome: 'rejected', revision, problems });
    return { ok: false, edition: rules.id, revision, problems };
  }
  const draft = draftEdition({ number, manifest, channels: records.channels, games: records.games, taxonomyText, foundedAt: now, withheld: withheld.ids });
  const founding = foundingRecord(draft, number, manifest, authorization, key.fingerprint, withheld.key);
  writeNewEdition(dataDir, {
    id: rules.id, edition: draft.edition, founding, worldBytes: draft.worldBytes, taxonomyText, ledgerText: draft.ledgerText, state: draft.state, now,
  }, key);
  appendFoundingLog(dataDir, { at: now, edition: rules.id, outcome: 'founded', revision, problems: [] });
  return { ok: true, edition: rules.id, revision, problems: [], settlers: draft.settlers.length, worldHash: draft.edition.worldHash };
}

export type SettleResult =
  | { outcome: 'no-edition' }
  | { outcome: 'settled'; edition: string; revision: string; summary: NightResult['summary']; settlers: number }
  | { outcome: 'moderated'; edition: string; revision: string; hidden: number; settlers: number }
  | { outcome: 'up-to-date'; edition: string; revision: string };

/** An edition's files read once and verified as read, so what is settled is exactly what was verified. */
function readVerifiedEdition(dataDir: string, id: string, key: ReturnType<typeof keyFrom>): { files: EditionFiles; report: EditionReport } {
  const files = readEditionFiles(dataDir, id);
  return { files, report: verifyEdition(files, key) };
}

/**
 * One cartography run into the newest founded edition, after verifying that edition completely. The withheld list
 * is read on every run, before anything else is decided: a newer revision settles a whole night; without one, newly
 * withheld holdings still get their hidden tombstones now rather than at the next survey. Every append is verified
 * as the edition it would produce before the ledger is replaced.
 */
export function runSettle(dataDir: string, founderKeyPem: string | null, now: number): SettleResult {
  const editions = listEditions(dataDir);
  const id = editions[editions.length - 1];
  if (!id) return { outcome: 'no-edition' };
  const key = keyFrom(founderKeyPem);
  let { files, report } = readVerifiedEdition(dataDir, id, key);
  const tail = report.problems.find((p) => p.includes('no head acknowledges'));
  if (tail && report.problems.length === 1 && report.state) {
    acknowledgeHead(dataDir, id, report.state, report.state.lastNight?.revision ?? report.world!.revision, now);
    ({ files, report } = readVerifiedEdition(dataDir, id, key));
  }
  if (report.problems.length || !report.state || !report.world) throw new AtlasError('check', `${id} failed verification; nothing was settled.`, report.problems);
  const withheld = readWithheldList(dataDir);
  if ('error' in withheld) throw new AtlasError('check', 'The withheld list is unreadable; hidden land cannot be judged, so nothing was settled.', [withheld.error]);
  const revision = currentRevision(dataDir);
  const { manifest, records } = readVerifiedRevision(dataDir, revision);
  const state = report.state;
  if (state.lastNight && manifest.asOf <= state.lastNight.asOf) {
    const hidden = hideWithheld(state, withheld.ids, state.lastNight.revision, now);
    if (!hidden.length) return { outcome: 'up-to-date', edition: id, revision };
    const { text, next } = extendLedger(state, hidden);
    appendSettlement(dataDir, id, { files, text, next, revision: state.lastNight.revision, now }, key);
    return { outcome: 'moderated', edition: id, revision: state.lastNight.revision, hidden: hidden.length, settlers: next.settlers.length };
  }
  const ctx = editionContext(report.world, loadTaxonomy(files.taxonomyText));
  const night = settleNight({
    number: id === 'ed-0' ? '0' : 'I', ctx, state, manifest,
    channels: records.channels, raidPairs: records.raidPairs, raidObservations: records.raidObservations, withheld: withheld.ids,
  });
  const { text, next } = extendLedger(state, night.events);
  appendSettlement(dataDir, id, { files, text, next, revision, now }, key);
  return { outcome: 'settled', edition: id, revision, summary: night.summary, settlers: next.settlers.length };
}

export interface RehearsalNight {
  revision: string;
  asOf: number;
  summary: NightResult['summary'] | null;
  settlers: number;
  moved: number;
  problems: string[];
}

/**
 * A rehearsal on real data that founds nothing: draws an edition in memory from the oldest kept revision, settles
 * every later revision into it in order, and proves after each night that no earlier holding moved and every
 * invariant holds. Nothing is written; the gates are not consulted because nothing official results.
 */
export function runRehearsal(dataDir: string, number: EditionNumber, now: number): { founding: { revision: string; settlers: number; hidden: number; worldHash: string; realms: number; hamletSlots: number }; nights: RehearsalNight[] } {
  const revisions = readdirSync(layout(dataDir).revisions).sort();
  if (revisions.length < 2) throw new AtlasError('inventory-missing', 'A rehearsal needs at least two kept revisions; import again later.');
  const taxonomyText = currentTaxonomyText();
  // The current withheld list stands in for the list at every rehearsed night; the past lists were not kept.
  const withheld = readWithheldList(dataDir);
  if ('error' in withheld) throw new AtlasError('check', 'The withheld list is unreadable; hidden land cannot be judged, so nothing was rehearsed.', [withheld.error]);
  const draft = (() => {
    const first = readVerifiedRevision(dataDir, revisions[0]!);
    return draftEdition({ number, manifest: first.manifest, channels: first.records.channels, games: first.records.games, taxonomyText, foundedAt: now, withheld: withheld.ids });
  })();
  const ctx = editionContext(draft.world, loadTaxonomy(taxonomyText));
  let state = draft.state;
  let ledgerText = draft.ledgerText;
  const heads = [{ version: 1 as const, lines: state.lines, settlers: state.settlers.length, head: state.head, revision: draft.world.revision, at: now }];
  const nights: RehearsalNight[] = [];
  for (const revision of revisions.slice(1)) {
    const { manifest, records } = readVerifiedRevision(dataDir, revision);
    const before = state.settlers;
    const night = settleNight({
      number, ctx, state, manifest, channels: records.channels, raidPairs: records.raidPairs, raidObservations: records.raidObservations,
      withheld: withheld.ids,
    });
    const { text, next } = extendLedger(state, night.events);
    ledgerText += text;
    state = next;
    heads.push({ version: 1, lines: state.lines, settlers: state.settlers.length, head: state.head, revision, at: now });
    let moved = 0;
    for (const [ordinal, old] of before.entries()) {
      const after = state.settlers[ordinal]!;
      if (after.kingdomId !== old.kingdomId || after.holdingId !== old.holdingId || after.point.x !== old.point.x || after.point.y !== old.point.y ||
        after.realmIndex !== old.realmIndex || after.holdingTier !== old.holdingTier || after.settledAt !== old.settledAt) moved++;
    }
    const report = verifyEdition({ edition: draft.edition, worldBytes: draft.worldBytes, taxonomyText, ledgerText, heads, founding: null }, null);
    nights.push({ revision, asOf: manifest.asOf, summary: night.summary, settlers: state.settlers.length, moved, problems: report.problems });
  }
  return {
    founding: {
      revision: draft.world.revision, settlers: draft.settlers.length, hidden: draft.state.tombstones.size, worldHash: draft.edition.worldHash, realms: draft.world.realms.length,
      hamletSlots: draft.world.realms.reduce((sum, realm) => sum + realm.slots, 0),
    },
    nights,
  };
}

/** Founder tooling: signs an authorization for the current revision and taxonomy with a private key kept elsewhere. */
export function runAuthorize(dataDir: string, number: EditionNumber, privateKeyPath: string, issuedBy: string, now: number): Authorization {
  const revision = currentRevision(dataDir);
  const taxonomy = loadTaxonomy(currentTaxonomyText()).ref;
  return signAuthorization({ kind: 'chatdom-atlas-founding-authorization', edition: number, revision, taxonomySha256: taxonomy.sha256, issuedAt: now, issuedBy }, readFileSync(privateKeyPath, 'utf8'));
}
