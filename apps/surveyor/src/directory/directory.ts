import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../export/project';
import { AvatarUrlSchema, RAW_CONTENT_MAX_AGE_MS, type ChannelObservation, type SnapshotManifest } from '../export/schema';
import { dabHash } from '../live/frame';
import { loadLiveTarget } from '../live/target';
import { nameFreshUntil, publicVisibility } from '../policy/visibility';
import { readManifest, revisionDir } from '../store/revisions';
import { matchRank, queryKey, searchKey } from './normalize';
import {
  CARD_ROADS, CardReplySchema, DIRECTORY_KIND, MAX_RESULTS, RoadReplySchema, SearchReplySchema,
  type CardReply, type CardRoad, type ChannelFace, type ChannelPortrait, type RoadReply, type SearchReply,
} from './schema';

/**
 * One channel of the register, as observed by the preview's own revision. Only public, non-gambling, present
 * channels are entries; the rest are remembered by ID alone so their roads can be left out.
 */
interface Entry {
  id: string;
  login: string;
  name: string;
  loginKey: string;
  nameKey: string;
  /** When the source last confirmed login and display name. Names remain served between imports. */
  factsAt: number;
  avatarUrl: string | null;
  avatarFactsAt: number | null;
  firstSeenAt: number;
  lastLiveAt: number;
  average: number;
  language: string;
  live: boolean;
  stream: ChannelObservation['stream'];
  /** Settler ordinal and tier rank when it holds land in this preview, otherwise -1. */
  ordinal: number;
  tier: number;
  region: number;
  realm: number;
}

interface Tally { raids: number; travellers: number; lastAt: number }

export type Lookup = { id: string } | { login: string } | { dab: string };

/** Why a reply could not be given; the service maps each to one bounded public error. */
export type DirectoryRefusal = 'not-found' | 'empty' | 'too-long';

/**
 * The searchable register of one survey preview. Built once from immutable, hash-checked files; every answer is
 * projected at request time against the current withheld list and clock. Names always remain served between
 * survey refreshes; stream titles still expire after a day.
 */
export class Directory {
  private readonly byId = new Map<string, Entry>();
  private readonly byLogin = new Map<string, Entry>();
  private byHash: Map<string, Entry> | null = null;
  private readonly roads = new Map<string, Map<string, { sent: Tally | null; received: Tally | null }>>();
  private readonly regionOfRealm: number[];

  constructor(
    readonly preview: string,
    readonly manifest: SnapshotManifest,
    /** Entries ordered by observed average audience, largest first, then channel ID: the order ties resolve in. */
    private readonly entries: readonly Entry[],
    /** Channels the survey saw but the gate keeps off the map entirely (gone, gambling). */
    private readonly blocked: ReadonlySet<string>,
    pairs: readonly { from: string; to: string; tally: Tally }[],
    realmRegions: readonly number[],
  ) {
    this.regionOfRealm = [...realmRegions];
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
      const held = this.byLogin.get(entry.login);
      // A login can pass to another channel; the more recently confirmed one owns it.
      if (!held || entry.factsAt > held.factsAt) this.byLogin.set(entry.login, entry);
    }
    for (const { from, to, tally } of pairs) {
      this.side(from, to).sent = tally;
      this.side(to, from).received = tally;
    }
  }

  private side(a: string, b: string): { sent: Tally | null; received: Tally | null } {
    let map = this.roads.get(a);
    if (!map) {
      map = new Map();
      this.roads.set(a, map);
    }
    let pair = map.get(b);
    if (!pair) {
      pair = { sent: null, received: null };
      map.set(b, pair);
    }
    return pair;
  }

  get revision(): string {
    return this.manifest.revision;
  }

  get size(): number {
    return this.entries.length;
  }

  /** A channel as it may be shown now, or null when the gate keeps it off the map. */
  private face(id: string, withheld: ReadonlySet<string>, now: number): ChannelFace | null {
    if (withheld.has(id) || this.blocked.has(id)) return null;
    const entry = this.byId.get(id);
    if (!entry) return { id: id as ChannelFace['id'], login: null, name: null, freshUntil: null, place: 'unseen', ordinal: null, tier: null, region: null, realm: null };
    const mapped = entry.ordinal >= 0;
    return {
      id: id as ChannelFace['id'],
      login: entry.login,
      name: entry.name,
      freshUntil: Math.max(nameFreshUntil(entry.factsAt), now + 86_400_000),
      place: mapped ? 'mapped' : 'waiting',
      ordinal: mapped ? entry.ordinal : null,
      tier: mapped ? entry.tier : null,
      region: entry.region,
      realm: entry.realm,
    };
  }

  private reply(now: number) {
    return { version: 1 as const, preview: this.preview, revision: this.manifest.revision, servedAt: now, asOf: this.manifest.asOf };
  }

  private portrait(entry: Entry, now: number): ChannelPortrait | null {
    // Older exports merged the login and live clocks. They cannot establish an avatar's age.
    const at = entry.avatarFactsAt;
    if (at === null || at > now + 60_000 || at + RAW_CONTENT_MAX_AGE_MS <= now || !AvatarUrlSchema.safeParse(entry.avatarUrl).success) return null;
    return { url: entry.avatarUrl!, freshUntil: at + RAW_CONTENT_MAX_AGE_MS };
  }

  private window() {
    return { from: this.manifest.window.firstObservationAt, to: Math.max(this.manifest.window.firstObservationAt, this.manifest.source.database.openedAt) };
  }

  private coverage() {
    const watch = this.manifest.coverage.raidWatch;
    return { raidWatch: { enabled: watch.enabled, watching: watch.watching, liveCandidates: watch.liveCandidates }, contentLabels: 'not-collected' as const };
  }

  /**
   * Channels whose login or display name matches, best match first: the same name, then names beginning with it, then
   * a word beginning with it, then names containing it; within each, the larger observed audience, then channel ID.
   * Names stay searchable between survey imports; withholding is applied to every response.
   */
  search(raw: string, withheld: ReadonlySet<string>, now: number, portraits = true): SearchReply | DirectoryRefusal {
    const query = queryKey(raw);
    if (!query.ok) return query.reason;
    const ranks: Entry[][] = [[], [], [], []];
    let matched = 0;
    for (const entry of this.entries) {
      let rank = matchRank(entry.loginKey, query.key, query.length);
      if (rank !== 0 && entry.nameKey !== entry.loginKey) {
        const byName = matchRank(entry.nameKey, query.key, query.length);
        if (byName >= 0 && (rank < 0 || byName < rank)) rank = byName;
      }
      if (rank < 0 || withheld.has(entry.id)) continue;
      matched++;
      if (ranks[rank]!.length < MAX_RESULTS) ranks[rank]!.push(entry);
    }
    const chosen = ranks.flat().slice(0, MAX_RESULTS);
    return SearchReplySchema.parse({
      ...this.reply(now),
      kind: `${DIRECTORY_KIND}-search`,
      key: query.key,
      results: chosen.map((entry) => ({ channel: this.face(entry.id, withheld, now)!, ...(portraits ? { portrait: this.portrait(entry, now) } : {}), average: entry.average, language: entry.language })),
      more: matched > chosen.length,
    });
  }

  private find(lookup: Lookup): Entry | null {
    if ('id' in lookup) return this.byId.get(lookup.id) ?? null;
    // The current survey owns login and dab resolution until its next refresh.
    if ('login' in lookup) {
      const entry = this.byLogin.get(lookup.login);
      return entry ?? null;
    }
    if (!this.byHash) this.byHash = new Map(this.entries.filter((entry) => entry.ordinal < 0).map((entry) => [dabHash(entry.id), entry]));
    const entry = this.byHash.get(lookup.dab);
    return entry ?? null;
  }

  /** A channel's public card, or not-found when it is unknown, withheld, gone or gambling (all alike to a reader). */
  card(lookup: Lookup, withheld: ReadonlySet<string>, now: number, portraits = true): CardReply | DirectoryRefusal {
    const entry = this.find(lookup);
    const channel = entry && this.face(entry.id, withheld, now);
    if (!entry || !channel) return 'not-found';
    const roads: CardRoad[] = [];
    for (const [other, pair] of this.roads.get(entry.id) ?? []) {
      const face = this.face(other, withheld, now);
      if (!face) continue;
      const lastAt = Math.max(pair.sent?.lastAt ?? 0, pair.received?.lastAt ?? 0);
      roads.push({
        other: face,
        sent: pair.sent?.raids ?? 0,
        received: pair.received?.raids ?? 0,
        travellers: (pair.sent?.travellers ?? 0) + (pair.received?.travellers ?? 0),
        lastAt,
      });
    }
    // Strongest: most raids either way, then most travellers, then the latest, then channel ID.
    roads.sort((a, b) => (b.sent + b.received) - (a.sent + a.received) || b.travellers - a.travellers || b.lastAt - a.lastAt || compareId(a.other.id, b.other.id));
    const streamFresh = entry.stream && nameFreshUntil(entry.lastLiveAt) > now;
    return CardReplySchema.parse({
      ...this.reply(now),
      kind: `${DIRECTORY_KIND}-card`,
      channel,
      ...(portraits ? { portrait: this.portrait(entry, now) } : {}),
      average: entry.average,
      language: entry.language,
      firstSeenAt: entry.firstSeenAt,
      lastLiveAt: entry.lastLiveAt,
      stream: streamFresh ? {
        live: entry.live,
        game: entry.stream!.game,
        title: entry.stream!.title,
        viewers: entry.stream!.viewers,
        startedAt: entry.stream!.startedAt,
      } : null,
      roads: { window: this.window(), total: roads.length, strongest: roads.slice(0, CARD_ROADS) },
      coverage: this.coverage(),
    });
  }

  /** The road between two channels: what the raid watch saw each way, or nothing seen, never an invented raid. */
  road(a: Lookup, b: Lookup, withheld: ReadonlySet<string>, now: number): RoadReply | DirectoryRefusal {
    const first = this.find(a);
    const second = this.find(b);
    if (!first || !second || first.id === second.id) return 'not-found';
    const faceA = this.face(first.id, withheld, now);
    const faceB = this.face(second.id, withheld, now);
    if (!faceA || !faceB) return 'not-found';
    const pair = this.roads.get(first.id)?.get(second.id);
    return RoadReplySchema.parse({
      ...this.reply(now),
      kind: `${DIRECTORY_KIND}-road`,
      a: faceA,
      b: faceB,
      aToB: pair?.sent ?? null,
      bToA: pair?.received ?? null,
      window: this.window(),
      coverage: this.coverage(),
    });
  }

  /** The region a realm lies in (for tests and checks). */
  regionOf(realm: number): number | undefined {
    return this.regionOfRealm[realm];
  }
}

function compareId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Reads an ndjson file line by line while hashing it, so a 300 MB inventory never becomes one string. */
async function readNdjson(path: string, expected: string, each: (record: unknown) => void): Promise<void> {
  const hash = createHash('sha256');
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let nl = data.indexOf(10, start); nl >= 0; nl = data.indexOf(10, start)) {
      if (nl > start) each(JSON.parse(data.toString('utf8', start, nl)));
      start = nl + 1;
    }
    carry = Buffer.from(data.subarray(start));
  }
  if (carry.length) each(JSON.parse(carry.toString('utf8')));
  if (hash.digest('hex') !== expected) throw new Error(`${path} does not match its pinned hash.`);
}

/**
 * Builds the register of one preview from its own observation revision: the preview's verified land for holdings,
 * the revision's hash-checked channel inventory and raid aggregates. Throws when any file fails its hash.
 */
export async function loadDirectory(dataDir: string, previewId: string): Promise<Directory> {
  const target = await loadLiveTarget(dataDir, previewId);
  const { manifest } = readManifest(dataDir, target.world.revision);
  const dir = revisionDir(dataDir, manifest.revision);
  const realmRegions = target.world.realms.map((realm) => realm.region);
  const entries: Entry[] = [];
  const blocked = new Set<string>();
  await readNdjson(join(dir, manifest.files.channels.path), manifest.files.channels.sha256, (record) => {
    const channel = record as ChannelObservation;
    if (publicVisibility(channel) !== 'public') {
      blocked.add(channel.kingdomId);
      return;
    }
    const ordinal = target.ordinalOf.get(channel.kingdomId) ?? -1;
    // Land: the realm it is drawn in. Waiting: the realm a pencil flag of it is drawn in (the live layer's own rule).
    const realm = ordinal >= 0 ? target.realmOf[ordinal]! : target.realmFor({ id: channel.kingdomId, language: channel.language, categories: channel.categories });
    entries.push({
      id: channel.kingdomId,
      login: channel.login,
      name: channel.displayName,
      loginKey: searchKey(channel.login),
      nameKey: searchKey(channel.displayName),
      factsAt: channel.factsAt,
      avatarUrl: channel.avatarUrl,
      avatarFactsAt: channel.avatarFactsAt ?? null,
      firstSeenAt: channel.firstSeenAt,
      lastLiveAt: channel.lastLiveAt,
      average: Math.round(channel.averageViewers),
      language: channel.language,
      live: channel.live,
      stream: channel.stream,
      ordinal,
      tier: ordinal >= 0 ? target.tierRank[ordinal]! : -1,
      realm,
      region: realmRegions[realm] ?? 0,
    });
  });
  const pairsBytes = readFileSync(join(dir, manifest.files.raidPairs.path));
  if (sha256(pairsBytes) !== manifest.files.raidPairs.sha256) throw new Error(`${manifest.files.raidPairs.path} does not match its pinned hash.`);
  const pairs = pairsBytes.toString('utf8').split('\n').filter(Boolean).map((line) => {
    const pair = JSON.parse(line) as { fromKingdomId: string; toKingdomId: string; raids: number; viewersTotal: number; lastAt: number };
    return { from: pair.fromKingdomId, to: pair.toKingdomId, tally: { raids: pair.raids, travellers: pair.viewersTotal, lastAt: pair.lastAt } };
  });
  entries.sort((a, b) => b.average - a.average || compareId(a.id, b.id));
  return new Directory(target.previewId, manifest, entries, blocked, pairs, realmRegions);
}
