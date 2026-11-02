import type { KeyObject } from 'node:crypto';
import { AtlasEditionSchema, type AtlasEdition, type AtlasSettler } from '@chatdom/shared';
import { compareIds, sha256 } from '../export/project';
import type { ChannelObservation, Game, SnapshotManifest } from '../export/schema';
import { loadTaxonomy } from '../cartography/taxonomy';
import { COORD_SCALE } from '../preview/land';
import { drawWorld } from '../preview/build';
import { PREVIEW_ALGORITHM } from '../preview/schema';
import { verifyAuthorization } from './authorization';
import { extendLedger, emptyState, type LedgerEvent, type LedgerState } from './ledger';
import { EDITION_WORLD_KIND, EDITIONS, EditionWorldSchema, FoundingSchema, type Authorization, type EditionNumber, type EditionWorld, type Founding } from './schema';

export interface FoundingGateInput {
  number: EditionNumber;
  manifest: Pick<SnapshotManifest, 'revision' | 'founding' | 'window'>;
  taxonomy: { id: string; status: 'proposed' | 'reviewed'; sha256: string };
  /** The continent name table: Edition I needs it reviewed, though its labels never enter the land. */
  names: { id: string; status: 'proposed' | 'reviewed' };
  authorization: Authorization | null;
  founderKey: KeyObject | null;
  existing: boolean;
  now: number;
}

const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)} h`;
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Every reason an official founding must be refused, all at once. Empty means the gates pass. The duration counts
 * the source's own observation window, never the import or publication time.
 */
export function foundingGates(input: FoundingGateInput): string[] {
  const rules = EDITIONS[input.number];
  const problems: string[] = [];
  if (input.existing) problems.push(`${rules.label} is already founded; an edition is founded once and its land never moves.`);
  const observed = input.manifest.founding.observedMs;
  if (observed < rules.minObservedMs) {
    const eligible = input.number === '0' ? input.manifest.founding.edition0EligibleAt : input.manifest.founding.editionIEligibleAt;
    problems.push(`${rules.label} needs ${hours(rules.minObservedMs)} of observations; this survey has ${hours(observed)} (eligible from ${utc(eligible)}).`);
  }
  if (rules.requiresReviewedTaxonomy && input.taxonomy.status !== 'reviewed') {
    problems.push(`${rules.label} needs a reviewed family taxonomy; ${input.taxonomy.id} is still a proposal.`);
  }
  if (rules.requiresReviewedNames && input.names.status !== 'reviewed') {
    problems.push(`${rules.label} needs a reviewed continent name table; ${input.names.id} is still a proposal.`);
  }
  if (!input.founderKey) problems.push('No founder key is configured (ATLAS_FOUNDER_PUBLIC_KEY), so no authorization can be verified.');
  if (!input.authorization) problems.push('No founder authorization was given (--authorization <file>).');
  else {
    const payload = input.authorization.payload;
    if (payload.edition !== input.number) problems.push(`The authorization is for Edition ${payload.edition}, not ${rules.label}.`);
    if (payload.revision !== input.manifest.revision) problems.push(`The authorization names revision ${payload.revision}, not the current ${input.manifest.revision}.`);
    if (payload.taxonomySha256 !== input.taxonomy.sha256) problems.push('The authorization names different family taxonomy bytes.');
    if (payload.issuedAt > input.now) problems.push('The authorization is dated in the future.');
    if (input.founderKey && !verifyAuthorization(input.authorization, input.founderKey)) problems.push('The authorization signature does not verify against the founder key.');
  }
  return problems;
}

export interface DraftEdition {
  edition: AtlasEdition;
  world: EditionWorld;
  worldBytes: Uint8Array;
  taxonomyText: string;
  /** The founding settlers in ordinal order (channel ID order). */
  settlers: AtlasSettler[];
  ledgerText: string;
  state: LedgerState;
}

const encoder = new TextEncoder();

/**
 * Draws an edition's world from one revision and settles every mapped channel on it. Pure: no gate, no write. The
 * official command calls it only after `foundingGates` passes; the rehearsal calls it in memory and keeps nothing.
 */
export function draftEdition(input: {
  number: EditionNumber;
  manifest: SnapshotManifest;
  channels: readonly ChannelObservation[];
  games: readonly Game[];
  taxonomyText: string;
  foundedAt: number;
  /** The withheld list at founding: these channels are settled like any other, then tombstoned as hidden at once. */
  withheld: ReadonlySet<string>;
}): DraftEdition {
  const rules = EDITIONS[input.number];
  const taxonomy = loadTaxonomy(input.taxonomyText);
  const { layout, geometry } = drawWorld({ channels: input.channels, games: input.games, taxonomy });
  const world = EditionWorldSchema.parse({
    version: 1,
    kind: EDITION_WORLD_KIND,
    edition: rules.id,
    algorithm: PREVIEW_ALGORITHM,
    revision: input.manifest.revision,
    asOf: input.manifest.asOf,
    ...geometry,
  });
  const worldBytes = encoder.encode(`${JSON.stringify(world)}\n`);
  const edition = AtlasEditionSchema.parse({
    version: 1,
    id: rules.id,
    label: rules.label,
    status: 'frozen',
    foundedAt: input.foundedAt,
    worldHash: sha256(worldBytes),
    realmCount: world.realms.length,
  });
  const q = (value: number) => Math.round(value * COORD_SCALE) / COORD_SCALE;
  const settlers: AtlasSettler[] = [...layout.settlers]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((placed, ordinal) => ({
      ordinal,
      kingdomId: placed.id as AtlasSettler['kingdomId'],
      holdingId: `f:${ordinal}`,
      realmIndex: placed.realm,
      holdingTier: placed.tier,
      point: { x: q(placed.x), y: q(placed.y) },
      settledAt: input.manifest.asOf,
    }));
  const revision = input.manifest.revision;
  const events: LedgerEvent[] = settlers.map((settler) => ({ kind: 'settle', settler, reason: 'founding', path: 'realm', revision }));
  // A withheld channel still holds the land it was drawn on, so nobody else can be granted it, but that land is
  // waiting from the first night: its holding is tombstoned before the edition is ever read.
  const hidden = settlers.filter((settler) => input.withheld.has(settler.kingdomId));
  for (const settler of hidden) {
    events.push({ kind: 'tombstone', kingdomId: settler.kingdomId, holdingId: settler.holdingId, cause: 'hidden', at: input.manifest.asOf, revision });
  }
  events.push({ kind: 'night', revision, asOf: input.manifest.asOf, settled: settlers.length, byRaid: 0, outer: 0, tombstones: hidden.length, restores: 0, deferred: 0 });
  const { text, next } = extendLedger(emptyState(edition.worldHash), events);
  return { edition, world, worldBytes, taxonomyText: input.taxonomyText, settlers, ledgerText: text, state: next };
}

export function foundingRecord(
  draft: DraftEdition, number: EditionNumber, manifest: SnapshotManifest, authorization: Authorization, founderKey: string, withheldKey: string,
  names?: { id: string; status: 'proposed' | 'reviewed'; sha256: string }, rehearsal?: { waived: string[] },
): Founding {
  const taxonomy = loadTaxonomy(draft.taxonomyText).ref;
  return FoundingSchema.parse({
    version: 1,
    kind: 'chatdom-atlas-founding',
    edition: EDITIONS[number].id,
    number,
    revision: manifest.revision,
    asOf: manifest.asOf,
    window: { firstObservationAt: manifest.window.firstObservationAt, lastObservationAt: manifest.window.lastObservationAt, observedMs: manifest.founding.observedMs },
    taxonomy: { id: taxonomy.id, status: taxonomy.status, sha256: taxonomy.sha256 },
    authorization,
    founderKey,
    settlers: draft.settlers.length,
    withheld: { key: withheldKey, hidden: draft.state.tombstones.size },
    ...(names ? { names } : {}),
    ...(rehearsal ? { rehearsal } : {}),
  });
}
