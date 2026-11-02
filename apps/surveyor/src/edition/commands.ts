import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkRevisionDir, type RevisionRecords } from '../check';
import { AtlasError } from '../errors';
import { sha256 } from '../export/project';
import type { SnapshotManifest } from '../export/schema';
import { currentTaxonomyText, loadTaxonomy } from '../cartography/taxonomy';
import { WITHHELD_FILE, WithheldSchema } from '../policy/visibility';
import { MANIFEST_FILE, layout, readCurrent, revisionDir } from '../store/revisions';
import { founderKey, signAuthorization } from './authorization';
import { draftEdition, foundingGates, foundingRecord } from './found';
import { extendLedger, replayLedger } from './ledger';
import { AuthorizationSchema, EDITIONS, type Authorization, type AuthorizationPayload, type EditionNumber } from './schema';
import { editionContext, hideWithheld, settleNight, type NightResult } from './settle';
import { acknowledgeHead, appendFoundingLog, appendSettlement, listEditions, readEditionFiles, writeNewEdition } from './store';
import { currentNamesText, namesRefOf } from '../cartography/names-ref';
import { readClaims, witnessedRoadRaids } from './claims';
import { appendArrivals, arrivalsToCheck, checkArrivals, absentArrivals, foundArrivals, readArrivals, type ArrivalCheck, type RaidRef } from './arrivals';
import type { AtlasRaid } from '@chatdom/shared';
import type { TwitchLookup } from '../directory/twitch-lookup';
import { buildEditionPublication, editionAddress, ledgerPrefix, readPublished, writePublication, type ArrivedName } from './publish';
import { previewDir, verifyPreviewDir } from '../preview/store';
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

export interface FoundResult { ok: boolean; edition: string; revision: string | null; problems: string[]; settlers?: number; worldHash?: string; address?: string; publication?: string }

/** Whether this process may serve or settle a rehearsal edition: only a bench started with ATLAS_REHEARSAL=1. */
export const rehearsalAllowed = (env: NodeJS.ProcessEnv = process.env) => env.ATLAS_REHEARSAL === '1';

/**
 * The official founding command. Every gate is checked before anything is drawn; a refusal is logged in
 * ledger/foundings.ndjson and changes nothing else. The founding is pinned to the revision the authorization names
 * (`--revision`, else the current one), and its founding time is the moment the founder signed, so the same signed
 * authorization over the same revision, taxonomy and withheld list founds byte-identical edition files anywhere.
 */
export function runFound(
  dataDir: string, number: EditionNumber, authorizationPath: string | null, founderKeyPem: string | null, now: number, options: { revision?: string | undefined } = {},
): FoundResult {
  const rules = EDITIONS[number];
  const revision = options.revision ?? currentRevision(dataDir);
  const { manifest, records } = readVerifiedRevision(dataDir, revision);
  const taxonomyText = currentTaxonomyText();
  const taxonomy = loadTaxonomy(taxonomyText).ref;
  const names = namesRefOf(currentNamesText());
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
    number, manifest, taxonomy, names, authorization, founderKey: key?.key ?? null,
    existing: listEditions(dataDir).includes(rules.id), now,
  }));
  if (problems.length || !authorization || !key || 'error' in withheld) {
    appendFoundingLog(dataDir, { at: now, edition: rules.id, outcome: 'rejected', revision, problems });
    return { ok: false, edition: rules.id, revision, problems };
  }
  const foundedAt = authorization.payload.issuedAt;
  const draft = draftEdition({ number, manifest, channels: records.channels, games: records.games, taxonomyText, foundedAt, withheld: withheld.ids });
  const founding = foundingRecord(draft, number, manifest, authorization, key.fingerprint, withheld.key, names);
  writeNewEdition(dataDir, {
    id: rules.id, edition: draft.edition, founding, worldBytes: draft.worldBytes, taxonomyText, ledgerText: draft.ledgerText, state: draft.state, now,
  }, key);
  appendFoundingLog(dataDir, { at: now, edition: rules.id, outcome: 'founded', revision, problems: [] });
  const published = publishEdition(dataDir, rules.id, key, false);
  return {
    ok: true, edition: rules.id, revision, problems: [], settlers: draft.settlers.length, worldHash: draft.edition.worldHash,
    address: published.address, publication: published.id,
  };
}

/**
 * What `atlas:found --prepare` prints and writes: the exact payload the founder signs on their own machine, with
 * every gate's state today. Nothing is founded or signed here; the private key never comes near this service.
 */
export function prepareFounding(dataDir: string, number: EditionNumber, now: number, options: { revision?: string | undefined; by: string }): {
  request: { version: 1; kind: 'chatdom-atlas-founding-request'; payload: Omit<AuthorizationPayload, 'issuedAt'>; summary: Record<string, unknown> };
  problems: string[];
} {
  const rules = EDITIONS[number];
  const revision = options.revision ?? currentRevision(dataDir);
  const { manifest } = readVerifiedRevision(dataDir, revision);
  const taxonomy = loadTaxonomy(currentTaxonomyText()).ref;
  const names = namesRefOf(currentNamesText());
  const problems = foundingGates({ number, manifest, taxonomy, names, authorization: null, founderKey: null, existing: listEditions(dataDir).includes(rules.id), now })
    // The key and the signature are what the request is for; every other gate must already pass.
    .filter((problem) => !problem.startsWith('No founder key') && !problem.startsWith('No founder authorization'));
  return {
    request: {
      version: 1,
      kind: 'chatdom-atlas-founding-request',
      payload: { kind: 'chatdom-atlas-founding-authorization', edition: number, revision, taxonomySha256: taxonomy.sha256, issuedBy: options.by },
      summary: {
        edition: rules.label,
        observed: `${(manifest.founding.observedMs / 86_400_000).toFixed(2)} days, ${new Date(manifest.window.firstObservationAt).toISOString()} to ${new Date(manifest.window.lastObservationAt).toISOString()}`,
        channels: manifest.counts.channels,
        taxonomy: `${taxonomy.id} (${taxonomy.status})`,
        names: `${names.id} (${names.status})`,
      },
    },
    problems,
  };
}

export type SettleResult =
  | { outcome: 'no-edition' }
  | { outcome: 'settled'; edition: string; revision: string; summary: NightResult['summary']; settlers: number; publication: string; arrivals?: ArrivalCheck['summary'] }
  | { outcome: 'moderated'; edition: string; revision: string; hidden: number; settlers: number; publication: string }
  | { outcome: 'up-to-date'; edition: string; revision: string; publication: string };

/** An edition's files read once and verified as read, so what is settled is exactly what was verified. */
function readVerifiedEdition(dataDir: string, id: string, key: ReturnType<typeof keyFrom>, allowRehearsal: boolean): { files: EditionFiles; report: EditionReport } {
  const files = readEditionFiles(dataDir, id);
  return { files, report: verifyEdition(files, key, { allowRehearsal }) };
}

/** Everything one settle run decides from, read and verified once under the data directory's lock. */
type SettleLoad =
  | { done: SettleResult }
  | {
    done: null; id: string; key: ReturnType<typeof keyFrom>; allowRehearsal: boolean; files: EditionFiles; report: EditionReport;
    withheld: ReadonlySet<string>; revision: string; manifest: SnapshotManifest; records: RevisionRecords; roadRaids: AtlasRaid[];
  };

function loadSettle(dataDir: string, founderKeyPem: string | null, now: number, options: { revision?: string | undefined; allowRehearsal?: boolean }): SettleLoad {
  const editions = listEditions(dataDir);
  const id = editions[editions.length - 1];
  if (!id) return { done: { outcome: 'no-edition' } };
  const allowRehearsal = options.allowRehearsal ?? rehearsalAllowed();
  const key = keyFrom(founderKeyPem);
  let { files, report } = readVerifiedEdition(dataDir, id, key, allowRehearsal);
  const tail = report.problems.find((p) => p.includes('no head acknowledges'));
  if (tail && report.problems.length === 1 && report.state) {
    acknowledgeHead(dataDir, id, report.state, report.state.lastNight?.revision ?? report.world!.revision, now);
    ({ files, report } = readVerifiedEdition(dataDir, id, key, allowRehearsal));
  }
  if (report.problems.length || !report.state || !report.world) throw new AtlasError('check', `${id} failed verification; nothing was settled.`, report.problems);
  const withheld = readWithheldList(dataDir);
  if ('error' in withheld) throw new AtlasError('check', 'The withheld list is unreadable; hidden land cannot be judged, so nothing was settled.', [withheld.error]);
  const revision = options.revision ?? currentRevision(dataDir);
  const { manifest, records } = readVerifiedRevision(dataDir, revision);
  const state = report.state;
  if (state.lastNight && manifest.asOf <= state.lastNight.asOf) {
    const hidden = hideWithheld(state, withheld.ids, state.lastNight.revision, now);
    if (!hidden.length) return { done: { outcome: 'up-to-date', edition: id, revision, publication: publishEdition(dataDir, id, key, allowRehearsal).id } };
    const { text, next } = extendLedger(state, hidden);
    appendSettlement(dataDir, id, { files, text, next, revision: state.lastNight.revision, now }, key, { allowRehearsal });
    return {
      done: {
        outcome: 'moderated', edition: id, revision: state.lastNight.revision, hidden: hidden.length, settlers: next.settlers.length,
        publication: publishEdition(dataDir, id, key, allowRehearsal).id,
      },
    };
  }
  const roadRaids = witnessedRoadRaids(dataDir, report.world.asOf, Math.max(now, manifest.asOf));
  return { done: null, id, key, allowRehearsal, files, report, withheld: withheld.ids, revision, manifest, records, roadRaids };
}

function finishSettle(dataDir: string, load: Exclude<SettleLoad, { done: SettleResult }>, now: number, arrivals?: ArrivalCheck['summary']): SettleResult {
  const { id, key, allowRehearsal, files, report, manifest, records, revision } = load;
  const state = report.state!;
  const ctx = editionContext(report.world!, loadTaxonomy(files.taxonomyText));
  const answers = readArrivals(dataDir);
  const night = settleNight({
    number: id === 'ed-0' ? '0' : 'I', ctx, state, manifest,
    channels: records.channels, raidPairs: records.raidPairs, raidObservations: records.raidObservations, withheld: load.withheld,
    claims: readClaims(dataDir),
    roadRaids: load.roadRaids,
    arrivals: foundArrivals(answers, manifest.asOf),
    absent: absentArrivals(answers, manifest.asOf),
  });
  const { text, next } = extendLedger(state, night.events);
  appendSettlement(dataDir, id, { files, text, next, revision, now }, key, { allowRehearsal });
  return {
    outcome: 'settled', edition: id, revision, summary: night.summary, settlers: next.settlers.length,
    publication: publishEdition(dataDir, id, key, allowRehearsal).id, ...(arrivals ? { arrivals } : {}),
  };
}

/**
 * One cartography run into the newest founded edition, after verifying that edition completely. The withheld list
 * is read on every run, before anything else is decided: a newer revision settles a whole night (newcomers, claims,
 * witnessed raids); without one, newly withheld holdings still get their hidden tombstones now rather than at the
 * next survey. Every append is verified as the edition it would produce before the ledger is replaced, and every run
 * ends with the map's publication of the head it leaves. Raided channels the survey never saw are granted only on
 * answers already in the arrivals log; `settleWithArrivals` asks Twitch for the missing ones first.
 */
export function runSettle(dataDir: string, founderKeyPem: string | null, now: number, options: { revision?: string | undefined; allowRehearsal?: boolean } = {}): SettleResult {
  const load = loadSettle(dataDir, founderKeyPem, now, options);
  return load.done ?? finishSettle(dataDir, load, now);
}

/**
 * The settle run imports and `atlas:settle` use: before a new night is settled, every raided channel the survey never
 * saw is checked with Twitch through the service's public, budgeted lookup (`arrivalsToCheck`, `checkArrivals`), and
 * the answers are fsynced to the arrivals log before the night reads them. Without credentials or budget the night
 * still settles; those raids wait for the next one. The caller holds the data directory's lock.
 */
export async function settleWithArrivals(
  dataDir: string, founderKeyPem: string | null, now: () => number, lookup: Pick<TwitchLookup, 'channels'> | null,
  options: { revision?: string | undefined; allowRehearsal?: boolean; budgetMs?: number } = {},
): Promise<SettleResult> {
  const started = now();
  const load = loadSettle(dataDir, founderKeyPem, started, options);
  if (load.done) return load.done;
  const state = load.report.state!;
  const until = Math.max(load.manifest.source.database.openedAt, ...load.roadRaids.map((raid) => raid.observedAt));
  const raids: RaidRef[] = [...load.records.raidObservations.map((observation) => observation.raid), ...load.roadRaids]
    // Every raid of this edition the night's sources still hold: one whose check failed before is asked again.
    .filter((raid) => raid.observedAt > load.report.world!.asOf && raid.observedAt <= until);
  const wanted = arrivalsToCheck({ state, channels: load.records.channels, raids, arrivals: readArrivals(dataDir), withheld: load.withheld });
  let summary: ArrivalCheck['summary'] = { asked: wanted.length, found: 0, absent: 0, unanswered: wanted.length, reason: wanted.length ? 'disabled' : null };
  if (wanted.length && lookup?.channels) {
    const checked = await checkArrivals(wanted, (ids) => lookup.channels!(ids), load.manifest.asOf, now, started + (options.budgetMs ?? 300_000));
    appendArrivals(dataDir, checked.arrivals);
    summary = checked.summary;
  }
  return finishSettle(dataDir, load, now(), summary);
}

/** One edition's publication at its current head: built from the verified files and the night's own revision. */
export function editionPublication(dataDir: string, id: string, key: ReturnType<typeof keyFrom>, allowRehearsal: boolean, lines?: number) {
  const { files, report } = readVerifiedEdition(dataDir, id, key, allowRehearsal);
  if (report.problems.length || !report.state || !report.world || !report.edition || !files.founding) {
    throw new AtlasError('check', `${id} failed verification; nothing was published.`, report.problems);
  }
  const address = editionAddress({ edition: report.edition, foundingBytes: files.foundingBytes ?? `${JSON.stringify(files.founding, null, 2)}\n`, taxonomyText: files.taxonomyText, ledgerText: files.ledgerText });
  const state = lines === undefined || lines === report.state.lines ? report.state : replayLedger(ledgerPrefix(files.ledgerText, lines), report.edition);
  if (!state.lastNight) throw new AtlasError('check', `${id} has no settled night to publish.`);
  const { manifest, records } = readVerifiedRevision(dataDir, state.lastNight.revision);
  const head = files.heads.find((entry) => entry.lines === state.lines && entry.head === state.head);
  const arrived = arrivedNames(dataDir, head?.at ?? Number.POSITIVE_INFINITY);
  const publication = buildEditionPublication({ edition: report.edition, founding: files.founding, world: report.world, address, state, manifest, channels: records.channels, arrived });
  return { publication, address, state, edition: report.edition, founding: files.founding };
}

/**
 * Names for holdings whose channel the night's survey did not observe: a raided channel's arrival answer, else a
 * claim's own Twitch lookup. Only answers recorded by the time the published head was acknowledged count, so a
 * publication rebuilt later (atlas:check, adoption) is byte-identical however the logs have grown since.
 */
export function arrivedNames(dataDir: string, cutoff: number): Map<string, ArrivedName> {
  const names = new Map<string, ArrivedName>();
  for (const arrival of readArrivals(dataDir)) {
    if (arrival.status !== 'found' || arrival.checkedAt > cutoff || names.has(arrival.kingdomId)) continue;
    names.set(arrival.kingdomId, { login: arrival.login, name: arrival.name, factsAt: arrival.checkedAt });
  }
  for (const claim of readClaims(dataDir)) {
    if (!claim.login || !claim.name || claim.receivedAt > cutoff || names.has(claim.kingdomId)) continue;
    names.set(claim.kingdomId, { login: claim.login, name: claim.name, factsAt: claim.receivedAt });
  }
  return names;
}

/**
 * Writes the map's publication of an edition's current head and points the service at it. Idempotent: an existing
 * publication must be byte-identical (it is content addressed by edition, head and revision).
 */
export function publishEdition(dataDir: string, id: string, key: ReturnType<typeof keyFrom>, allowRehearsal: boolean): { id: string; address: string; outcome: 'written' | 'existing' } {
  const { publication, address, state, edition, founding } = editionPublication(dataDir, id, key, allowRehearsal);
  const outcome = writePublication(dataDir, publication, {
    edition: edition.id, label: edition.label, address, revision: publication.manifest.revision, asOf: publication.manifest.asOf,
    head: state.head, lines: state.lines, foundedAt: edition.foundedAt, worldHash: edition.worldHash, rehearsal: founding.rehearsal !== undefined,
  });
  return { id: publication.id, address, outcome };
}

/** `atlas:publish`: the adoption step on a service that received founded edition files; it founds nothing. */
export function runPublish(dataDir: string, founderKeyPem: string | null): { id: string; address: string; outcome: 'written' | 'existing' } | null {
  const editions = listEditions(dataDir);
  const id = editions[editions.length - 1];
  if (!id) return null;
  return publishEdition(dataDir, id, keyFrom(founderKeyPem), rehearsalAllowed());
}

/**
 * The publication check behind `atlas:check`: the published pointer names this edition's current head, its files
 * verify, and rebuilding it from the edition files and the night's revision gives the same bytes.
 */
export function checkPublication(dataDir: string, id: string, key: ReturnType<typeof keyFrom>, allowRehearsal: boolean): string[] {
  const problems: string[] = [];
  let built;
  try {
    built = editionPublication(dataDir, id, key, allowRehearsal);
  } catch (error) {
    return [`${id} publication: ${error instanceof AtlasError ? [error.message, ...error.details].join(' ') : error instanceof Error ? error.message : String(error)}`.slice(0, 400)];
  }
  const pointer = readPublished(dataDir);
  if (!pointer) return [`${id} is founded but nothing is published (run atlas:publish).`];
  if (pointer.edition !== id || pointer.preview !== built.publication.id) problems.push(`${id}: the published map is ${pointer.preview}, but the edition's head draws ${built.publication.id}.`);
  if (pointer.address !== built.address) problems.push(`${id}: the published content address differs from the edition files.`);
  const dir = previewDir(dataDir, built.publication.id);
  if (!existsSync(dir)) return [...problems, `${id}: publication ${built.publication.id} is missing.`];
  problems.push(...verifyPreviewDir(dir, { id: built.publication.id, revision: built.publication.manifest.revision }).map((p) => `${built.publication.id}: ${p}`));
  for (const [name, bytes] of built.publication.files) {
    const file = join(dir, name);
    if (!existsSync(file) || sha256(readFileSync(file)) !== sha256(bytes)) problems.push(`${built.publication.id}: ${name} is not reproducible from the edition and its night.`);
  }
  return problems.slice(0, 12);
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
    const answers = readArrivals(dataDir);
    const night = settleNight({
      number, ctx, state, manifest, channels: records.channels, raidPairs: records.raidPairs, raidObservations: records.raidObservations,
      withheld: withheld.ids, arrivals: foundArrivals(answers, manifest.asOf), absent: absentArrivals(answers, manifest.asOf),
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

export interface StageResult {
  dataDir: string;
  publicKeyPath: string;
  waived: string[];
  founding: { revision: string; settlers: number; hidden: number; address: string; publication: string };
  nights: { revision: string; outcome: SettleResult['outcome']; settled: number; byRaid: number; byClaim: number; moved: number; publication: string }[];
}

/**
 * `atlas:rehearse --stage <dir>`: the whole founding and every later night, written for real into a separate bench
 * data directory, so the founded map can be served and looked at before the founder signs anything. The source data
 * directory is only read. The rehearsal is founded with a key made for it (its private half lives only in this
 * process and is thrown away; the public half is written beside the bench for its service), the gates it could not
 * pass are recorded as waived in founding.json, and every verifier refuses it unless ATLAS_REHEARSAL=1. It can never
 * become Edition I: the real founding needs the founder's own key, a fresh signature and a refounding from scratch.
 */
export function runStage(sourceDir: string, stageDir: string, number: EditionNumber, now: number): StageResult {
  const source = resolve(sourceDir);
  const target = resolve(stageDir);
  if (source === target || target.startsWith(`${source}/`)) throw new AtlasError('config', 'The rehearsal bench must be a separate directory, outside the data directory.');
  if (existsSync(target) && readdirSync(target).length) throw new AtlasError('config', `The rehearsal bench ${target} is not empty.`);
  const revisions = readdirSync(layout(source).revisions).filter((name) => existsSync(join(revisionDir(source, name), MANIFEST_FILE))).sort();
  if (!revisions.length) throw new AtlasError('inventory-missing', 'No kept revision to rehearse on.');
  mkdirSync(layout(target).revisions, { recursive: true });
  // The bench gets its own copy of every kept revision; the source directory is never written.
  for (const revision of revisions) cpSync(revisionDir(source, revision), revisionDir(target, revision), { recursive: true });
  for (const file of [WITHHELD_FILE]) if (existsSync(join(source, file))) cpSync(join(source, file), join(target, file));
  if (existsSync(join(source, 'roads', 'ledger.ndjson'))) {
    mkdirSync(join(target, 'roads'), { recursive: true });
    cpSync(join(source, 'roads', 'ledger.ndjson'), join(target, 'roads', 'ledger.ndjson'));
  }
  if (existsSync(join(source, 'claims'))) cpSync(join(source, 'claims'), join(target, 'claims'), { recursive: true });
  // The survey previews of those revisions, so the bench passes the same checks and can show the land before founding.
  if (existsSync(join(source, 'previews'))) cpSync(join(source, 'previews'), join(target, 'previews'), { recursive: true });
  const pointerFor = (revision: string) => {
    const manifestBytes = readFileSync(join(revisionDir(target, revision), MANIFEST_FILE));
    writeFileSync(layout(target).current, `${JSON.stringify({ version: 1, revision, manifestSha256: sha256(manifestBytes), switchedAt: now }, null, 2)}\n`);
  };

  const rules = EDITIONS[number];
  const first = revisions[0]!;
  pointerFor(first);
  const { manifest, records } = readVerifiedRevision(target, first);
  const taxonomyText = currentTaxonomyText();
  const taxonomy = loadTaxonomy(taxonomyText).ref;
  const names = namesRefOf(currentNamesText());
  const pair = generateKeyPairSync('ed25519');
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const key = founderKey(publicPem);
  const authorization = signAuthorization({
    kind: 'chatdom-atlas-founding-authorization', edition: number, revision: first, taxonomySha256: taxonomy.sha256, issuedAt: now, issuedBy: 'atlas_rehearsal',
  }, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const waived = foundingGates({ number, manifest, taxonomy, names, authorization, founderKey: key.key, existing: false, now });
  const withheld = readWithheldList(target);
  if ('error' in withheld) throw new AtlasError('check', 'The withheld list is unreadable; nothing was rehearsed.', [withheld.error]);
  const draft = draftEdition({ number, manifest, channels: records.channels, games: records.games, taxonomyText, foundedAt: now, withheld: withheld.ids });
  const founding = foundingRecord(draft, number, manifest, authorization, key.fingerprint, withheld.key, names, { waived });
  writeNewEdition(target, {
    id: rules.id, edition: draft.edition, founding, worldBytes: draft.worldBytes, taxonomyText, ledgerText: draft.ledgerText, state: draft.state, now,
  }, key, { allowRehearsal: true });
  const publicKeyPath = join(target, 'rehearsal-founder.pub.pem');
  writeFileSync(publicKeyPath, publicPem);
  const foundingPublication = publishEdition(target, rules.id, key, true);

  const nights: StageResult['nights'] = [];
  for (const revision of revisions.slice(1)) {
    pointerFor(revision);
    const before = readEditionFiles(target, rules.id);
    const was = verifyEdition(before, key, { allowRehearsal: true }).state!.settlers;
    const result = runSettle(target, publicPem, now, { allowRehearsal: true });
    const after = verifyEdition(readEditionFiles(target, rules.id), key, { allowRehearsal: true }).state!.settlers;
    const moved = was.filter((old, ordinal) => JSON.stringify(after[ordinal]) !== JSON.stringify(old)).length;
    const summary = result.outcome === 'settled' ? result.summary : null;
    nights.push({
      revision, outcome: result.outcome, settled: summary?.settled ?? 0, byRaid: summary?.byRaid ?? 0, byClaim: summary?.byClaim ?? 0, moved,
      publication: result.outcome === 'no-edition' ? '' : result.publication,
    });
  }
  return {
    dataDir: target, publicKeyPath, waived,
    founding: { revision: first, settlers: draft.settlers.length, hidden: draft.state.tombstones.size, address: foundingPublication.address, publication: foundingPublication.id },
    nights,
  };
}
