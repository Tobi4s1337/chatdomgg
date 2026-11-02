import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AtlasRaidSchema, EpochMsSchema, KingdomIdSchema, type AtlasRaid } from '@chatdom/shared';
import { compareIds } from '../export/project';
import { GameIdSchema } from '../export/schema';

/**
 * Claims (decision 19): a channel that is not yet a holding becomes one only when something claims it. Three things
 * do: a witnessed raid into it (read from the survey and the road ledger at settlement), its kingdom being founded in
 * Chatdom (`founded`), or its streamer signing in (`signed-in`). The last two arrive through the private claim
 * endpoint (`POST /v1/claims`); their producers are the session authority and Genesis. A claim is written durably
 * here before it is acknowledged, and the next settlement grants it the free slot at the channel's own pencil place,
 * so the place a visitor saw in search is the place it is inked.
 *
 * Nothing is granted before an edition is founded: claims recorded earlier wait in this log for the first night.
 */
export const CLAIMS_FILE = join('claims', 'claims.ndjson');
export const CLAIM_CAUSES = ['founded', 'signed-in'] as const;
export type ClaimCause = typeof CLAIM_CAUSES[number];

/** What a producer posts. The service adds the facts it knows; a producer never supplies a place or a tier. */
export const ClaimRequestSchema = z.strictObject({
  version: z.literal(1),
  kingdomId: KingdomIdSchema,
  cause: z.enum(CLAIM_CAUSES),
  /** When the sign-in or founding happened, by the producer's clock. */
  claimedAt: EpochMsSchema,
});
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

export const ClaimSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('chatdom-atlas-claim'),
  kingdomId: KingdomIdSchema,
  cause: z.enum(CLAIM_CAUSES),
  claimedAt: EpochMsSchema,
  receivedAt: EpochMsSchema,
  /** The channel's broadcaster language and main categories when the claim arrived: they decide its realm. */
  language: z.string().min(1).max(16),
  categories: z.array(z.strictObject({ gameId: GameIdSchema, minutes: z.number().int().min(1) })).max(8),
  /** Where those facts came from: the survey, or the service's own public Twitch lookup. */
  facts: z.enum(['survey', 'twitch']),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const claimsPath = (dataDir: string) => join(dataDir, CLAIMS_FILE);

/**
 * Every claim in the log, the first per channel and cause (a repeated sign-in claims nothing new). A torn last line
 * (a crash during an append) is ignored; any other unreadable line is an error, because a claim must never vanish.
 */
export function readClaims(dataDir: string): Claim[] {
  const path = claimsPath(dataDir);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  // A final line without its newline was never acknowledged; it is dropped and the producer retries.
  lines.pop();
  const seen = new Set<string>();
  const claims: Claim[] = [];
  lines.forEach((raw, index) => {
    if (!raw) return;
    let claim: Claim;
    try {
      claim = ClaimSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(`claims line ${index + 1} is not a valid claim.`);
    }
    const key = `${claim.kingdomId}:${claim.cause}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  });
  return claims;
}

/**
 * Appends one claim and fsyncs it before returning. A claim already in the log (same channel and cause) is a
 * duplicate and writes nothing. Single writer: only the Atlas service appends; settlement only reads.
 */
export function appendClaim(dataDir: string, claim: Claim, known: ReadonlySet<string>): 'recorded' | 'duplicate' {
  const parsed = ClaimSchema.parse(claim);
  const key = `${parsed.kingdomId}:${parsed.cause}`;
  if (known.has(key)) return 'duplicate';
  mkdirSync(join(dataDir, 'claims'), { recursive: true });
  const path = claimsPath(dataDir);
  // A torn tail from an earlier crash was never acknowledged: it is cut off so this claim starts on its own line.
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    if (bytes.length && bytes[bytes.length - 1] !== 0x0a) truncateSync(path, bytes.lastIndexOf(0x0a) + 1);
  }
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, `${JSON.stringify(parsed)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return 'recorded';
}

/** Claim keys already in the log, for duplicate detection without rereading it on every post. */
export function claimKeys(claims: readonly Claim[]): Set<string> {
  return new Set(claims.map((claim) => `${claim.kingdomId}:${claim.cause}`));
}

/** Claims in the order settlement grants them: earliest first, then by channel ID. */
export function claimOrder(a: Claim, b: Claim): number {
  return a.claimedAt - b.claimedAt || compareIds(a.kingdomId, b.kingdomId) || (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0);
}

/**
 * Witnessed raids from the road ledger other than the survey's own recorder (those arrive with each revision): the
 * raids raid-show's authority witnessed and published. Read-only, line by line; the road service keeps writing.
 * Observations only, never aggregates (a pair count is not an event) and never a simulation.
 */
export function witnessedRoadRaids(dataDir: string, after: number, until: number): AtlasRaid[] {
  const path = join(dataDir, 'roads', 'ledger.ndjson');
  if (!existsSync(path)) return [];
  const raids: AtlasRaid[] = [];
  const text = readFileSync(path, 'utf8');
  let offset = 0;
  while (offset < text.length) {
    const end = text.indexOf('\n', offset);
    if (end < 0) break;
    const raw = text.slice(offset, end);
    offset = end + 1;
    // Cheap filter first: the recorder's own raids are the bulk of the ledger and already reach settlement.
    if (!raw.includes('"kind":"observation"') || raw.includes('"source":"surveyor-recorder"')) continue;
    let raid: AtlasRaid;
    try {
      const parsed = JSON.parse(raw) as { body?: { kind?: string; raid?: unknown } };
      if (parsed.body?.kind !== 'observation') continue;
      raid = AtlasRaidSchema.parse(parsed.body.raid);
    } catch {
      continue;
    }
    if (raid.source === 'simulation' || raid.evidence.kind !== 'observed') continue;
    if (raid.observedAt <= after || raid.observedAt > until) continue;
    raids.push(raid);
  }
  return raids;
}
