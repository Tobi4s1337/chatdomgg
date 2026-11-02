import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TwitchLoginSchema, type KingdomId } from '@chatdom/shared';
import { compareIds } from '../export/project';
import { GameIdSchema, type ChannelObservation } from '../export/schema';
import type { LookupUnavailable, TwitchChannelFacts } from '../directory/twitch-lookup';
import type { LedgerState } from './ledger';

/**
 * Raid arrivals (decision 19, A13): a witnessed raid from a settled kingdom into a channel the survey never saw (it
 * streams to fewer than five people, so no sweep lists it) still claims land. The survey cannot say which language
 * and game that channel belongs to, so settlement asks Twitch, through the service's own public, budgeted lookup,
 * before it settles the night. Each answer is written here, fsynced, before the night that uses it:
 *
 *   found   the channel exists; its broadcaster language and current game decide its realm, and its login and
 *           display name label its holding on the map
 *   absent  Twitch has no such channel now (deleted or suspended); nothing is granted for raids seen before the
 *           check, and a later raid into it asks again
 *
 * A raid whose answer could not be had tonight (no credentials, budget reserve, Twitch down) is asked again at the
 * next night while its raid is still in the survey's window, and is granted then. Only settlement writes this file,
 * under the data directory's lock; the service and the map only read it.
 */
export const ARRIVALS_FILE = join('claims', 'raid-arrivals.ndjson');
export const arrivalsPath = (dataDir: string) => join(dataDir, ARRIVALS_FILE);

/** The most targets one night asks Twitch about: two Helix calls per hundred, well inside the lookup's budget. */
export const ARRIVAL_CHECKS_PER_NIGHT = 5_000;

const RaidRefSchema = z.strictObject({ id: z.string().min(1).max(160), fromKingdomId: KingdomIdSchema, observedAt: EpochMsSchema });

export const FoundArrivalSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('chatdom-atlas-raid-arrival'),
  status: z.literal('found'),
  kingdomId: KingdomIdSchema,
  login: TwitchLoginSchema,
  name: DisplayNameSchema,
  /** Broadcaster language and current game when it was checked: they decide the realm, as for a claim. */
  language: z.string().min(1).max(16),
  categories: z.array(z.strictObject({ gameId: GameIdSchema, minutes: z.number().int().min(1) })).max(1),
  checkedAt: EpochMsSchema,
  /** The survey night (its `asOf`) this check was made for. */
  night: EpochMsSchema,
  /** The witnessed raid that asked: from a settled kingdom, into this channel. */
  raid: RaidRefSchema,
});
export const AbsentArrivalSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('chatdom-atlas-raid-arrival'),
  status: z.literal('absent'),
  kingdomId: KingdomIdSchema,
  checkedAt: EpochMsSchema,
  night: EpochMsSchema,
});
export const ArrivalSchema = z.discriminatedUnion('status', [FoundArrivalSchema, AbsentArrivalSchema]);
export type FoundArrival = z.infer<typeof FoundArrivalSchema>;
export type Arrival = z.infer<typeof ArrivalSchema>;

/**
 * Every arrival in the log, in log order. A torn last line (a crash during an append) was never used and is
 * ignored; any other unreadable line is an error, because the land it granted must stay explainable.
 */
export function readArrivals(dataDir: string): Arrival[] {
  const path = arrivalsPath(dataDir);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.pop();
  return lines.flatMap((raw, index) => {
    if (!raw) return [];
    try {
      return [ArrivalSchema.parse(JSON.parse(raw))];
    } catch {
      throw new Error(`raid arrivals line ${index + 1} is not a valid arrival.`);
    }
  });
}

/** Appends a batch of arrivals in one write and fsyncs it before returning. Settlement is the only writer. */
export function appendArrivals(dataDir: string, arrivals: readonly Arrival[]): void {
  if (!arrivals.length) return;
  const text = arrivals.map((arrival) => `${JSON.stringify(ArrivalSchema.parse(arrival))}\n`).join('');
  mkdirSync(join(dataDir, 'claims'), { recursive: true });
  const path = arrivalsPath(dataDir);
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    if (bytes.length && bytes[bytes.length - 1] !== 0x0a) truncateSync(path, bytes.lastIndexOf(0x0a) + 1);
  }
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The first `found` answer per channel among arrivals checked for nights up to `asOf`: the facts its land is granted on. */
export function foundArrivals(arrivals: readonly Arrival[], asOf: number): Map<string, FoundArrival> {
  const found = new Map<string, FoundArrival>();
  for (const arrival of arrivals) if (arrival.status === 'found' && arrival.night <= asOf && !found.has(arrival.kingdomId)) found.set(arrival.kingdomId, arrival);
  return found;
}

/**
 * When Twitch last said a channel does not exist, per channel, among arrivals checked for nights up to `asOf`. A raid
 * into it from before that answer is owed nothing; a newer raid asks again.
 */
export function absentArrivals(arrivals: readonly Arrival[], asOf: number): Map<string, number> {
  const absent = new Map<string, number>();
  for (const arrival of arrivals) if (arrival.status === 'absent' && arrival.night <= asOf) absent.set(arrival.kingdomId, Math.max(absent.get(arrival.kingdomId) ?? 0, arrival.checkedAt));
  return absent;
}

/** A raid as far as land by raid needs it. */
export interface RaidRef { id: string; fromKingdomId: string; toKingdomId: string; observedAt: number }

/**
 * The channels tonight's settlement must ask Twitch about: targets of raids from a settled, untombstoned kingdom that
 * the night's survey did not observe and that hold no land, without a `found` answer, and without an `absent` answer
 * given after the raid. One entry per channel (its earliest such raid), earliest first, at most
 * ARRIVAL_CHECKS_PER_NIGHT; the rest wait for the next night.
 */
export function arrivalsToCheck(input: {
  state: Pick<LedgerState, 'owners' | 'tombstones'>;
  channels: readonly Pick<ChannelObservation, 'kingdomId'>[];
  raids: readonly RaidRef[];
  arrivals: readonly Arrival[];
  withheld: ReadonlySet<string>;
}): RaidRef[] {
  const observed = new Set<string>(input.channels.map((channel) => channel.kingdomId));
  const found = new Set<string>();
  const absentAt = new Map<string, number>();
  for (const arrival of input.arrivals) {
    if (arrival.status === 'found') found.add(arrival.kingdomId);
    else absentAt.set(arrival.kingdomId, Math.max(absentAt.get(arrival.kingdomId) ?? 0, arrival.checkedAt));
  }
  const wanted = new Map<string, RaidRef>();
  for (const raid of [...input.raids].sort(raidOrder)) {
    const to = raid.toKingdomId;
    if (wanted.has(to) || found.has(to) || observed.has(to) || input.state.owners.has(to as KingdomId) || input.withheld.has(to)) continue;
    if (!input.state.owners.has(raid.fromKingdomId as KingdomId) || input.state.tombstones.has(raid.fromKingdomId as KingdomId)) continue;
    if ((absentAt.get(to) ?? -1) >= raid.observedAt) continue;
    wanted.set(to, raid);
  }
  return [...wanted.values()].slice(0, ARRIVAL_CHECKS_PER_NIGHT);
}

export const raidOrder = (a: RaidRef, b: RaidRef) =>
  a.observedAt - b.observedAt || compareIds(a.toKingdomId, b.toKingdomId) || compareIds(a.fromKingdomId, b.fromKingdomId) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What asking Twitch about a batch of channel IDs gives: facts for those that exist, and the IDs Twitch does not know. */
export type CheckChannels = (ids: readonly string[]) => Promise<{ found: TwitchChannelFacts[]; absent: string[] }>;

export interface ArrivalCheck {
  arrivals: Arrival[];
  summary: { asked: number; found: number; absent: number; unanswered: number; reason: LookupUnavailable['reason'] | null };
}

/**
 * Asks Twitch about the wanted channels in batches of a hundred and turns the answers into arrivals. Stops at the
 * first refusal (budget reserve, upstream trouble, no credentials) or at the deadline; what was not answered is
 * simply asked again at the next night. Never writes anything itself.
 */
export async function checkArrivals(wanted: readonly RaidRef[], check: CheckChannels, night: number, clock: () => number, deadline: number): Promise<ArrivalCheck> {
  const arrivals: Arrival[] = [];
  let reason: ArrivalCheck['summary']['reason'] = null;
  let answered = 0;
  for (let start = 0; start < wanted.length; start += 100) {
    if (clock() >= deadline) {
      reason = 'limited';
      break;
    }
    const batch = wanted.slice(start, start + 100);
    let reply: Awaited<ReturnType<CheckChannels>>;
    try {
      reply = await check(batch.map((raid) => raid.toKingdomId));
    } catch (error) {
      reason = error instanceof Error && 'reason' in error && typeof error.reason === 'string' ? error.reason as ArrivalCheck['summary']['reason'] : 'upstream';
      break;
    }
    const facts = new Map(reply.found.map((fact) => [fact.id, fact]));
    const absent = new Set(reply.absent);
    const checkedAt = clock();
    for (const raid of batch) {
      const fact = facts.get(raid.toKingdomId);
      if (fact) {
        const login = TwitchLoginSchema.safeParse(fact.login);
        const name = DisplayNameSchema.safeParse(fact.name);
        const game = fact.gameId && GameIdSchema.safeParse(fact.gameId).success ? fact.gameId : null;
        if (!login.success || !name.success) continue;
        arrivals.push({
          version: 1, kind: 'chatdom-atlas-raid-arrival', status: 'found', kingdomId: raid.toKingdomId as FoundArrival['kingdomId'],
          login: login.data, name: name.data, language: (fact.language || 'other').slice(0, 16), categories: game ? [{ gameId: game, minutes: 1 }] : [],
          checkedAt, night, raid: { id: raid.id, fromKingdomId: raid.fromKingdomId as FoundArrival['kingdomId'], observedAt: raid.observedAt },
        });
        answered++;
      } else if (absent.has(raid.toKingdomId)) {
        arrivals.push({ version: 1, kind: 'chatdom-atlas-raid-arrival', status: 'absent', kingdomId: raid.toKingdomId as FoundArrival['kingdomId'], checkedAt, night });
        answered++;
      }
    }
  }
  return {
    arrivals,
    summary: {
      asked: wanted.length,
      found: arrivals.filter((arrival) => arrival.status === 'found').length,
      absent: arrivals.filter((arrival) => arrival.status === 'absent').length,
      unanswered: wanted.length - answered,
      reason,
    },
  };
}
