import { fishingHash, fishingHourBand, kingdomFishingHour, kingdomWaterMood, pierLightColour,
  type FishingEnvironment, type FishingRoll, type KingdomId, type PersonId, type PierFeedEvent, type PierFeedLine,
  type PierFeedWho, type Vec3 } from '@chatdom/shared';
import type { FishingInstallation } from './cast';
import { pierFrame } from './cast-site';
import { createFight, stepFight, verifyFight, FIGHT_TICK_MS, MAX_FIGHT_TICKS, type FightInput, type FightState } from './fight';
import { validFishingSeed, type FishingSpecies } from './species';

/** At most this many chat floats bob off the pier at once; the next `!fish` hears that the pier is full. */
export const CHAT_CAP = 8;
/** A gentle pause after a person's line comes in, before their next `!fish` is taken. */
export const CHAT_COOLDOWN_MS = 45_000;
/** "The pier is full" is said at most once per person in this window, so a full pier never floods the stream. */
export const CHAT_FULL_GAP_MS = 30_000;
const WAIT_MIN_MS = 6_000, WAIT_SPAN_MS = 9_000, LAND_MS = 900, BREAK_MS = 1_400;
const MAX_PEOPLE = 512;
const LATE_TICKS = 13, LATE_PERCENT = 8;

/** What the trusted writer needs to keep one chat catch: the same audit grammar as a walker's candidate. */
export interface ChatCatchCandidate {
  readonly version: 1; readonly castId: string; readonly personId: PersonId; readonly kingdomId: KingdomId;
  readonly at: number; readonly float: Vec3; readonly anchor: Vec3; readonly collisionRevision: number;
  readonly environment: FishingEnvironment; readonly fish: FishingRoll;
  readonly castSeed: number; readonly fightSeed: number; readonly inputs: readonly FightInput[]; readonly result: FightState;
}
export type ChatKeepResult =
  | { readonly status: 'kept'; readonly kingdomFirst: boolean; readonly keepsake: number | null; readonly replayed: boolean }
  | { readonly status: 'refused' | 'uncertain' | 'failed' };

export interface ChatFishingOptions {
  readonly kingdomId: KingdomId;
  readonly species: FishingSpecies;
  /** The kingdom's database time. */
  clock(): number;
  /** The adopted installation, or null where no pier stands or fishing is closed. */
  installation(): FishingInstallation | null;
  seed(): number;
  makeId(): string;
  /** One-shot timer returning its cancellation. */
  schedule(callback: () => void, delayMs: number): () => void;
  /** Writes catch, fish, mount and history in one transaction; idempotent by cast id. */
  keep(candidate: ChatCatchCandidate): Promise<ChatKeepResult>;
  publish(event: PierFeedEvent): void;
}
export type ChatCastOutcome = 'cast' | 'busy' | 'resting' | 'full' | 'closed';
export interface ChatCastInput {
  readonly personId: PersonId; readonly messageId: string; readonly slot: number;
  /** Approved public name, or null when it is hidden from public pages. */
  readonly name: string | null;
}

/**
 * A chat line's steady hand: the server plays it, never a browser. It reels while the fish rests, eases off as the
 * fish warns and runs, and keeps the line from going slack. Everyone's chat line plays the same way; nothing paid
 * or ranked changes it.
 */
export function chatFight(fightSeed: number, profile: FishingRoll['fight']): { readonly inputs: readonly FightInput[]; readonly result: FightState } {
  let state = createFight(fightSeed, profile), reel = false, runFrom = 0;
  const inputs: FightInput[] = [];
  for (let tick = 1; tick <= MAX_FIGHT_TICKS && state.outcome === 'active'; tick++) {
    if (state.phase === 'run' && runFrom === 0) runFrom = tick;
    if (state.phase !== 'run') runFrom = 0;
    // Now and then a chat hand is a moment late to give line as the fish runs: a fish can still win.
    const late = runFrom > 0 && tick - runFrom < LATE_TICKS && fishingHash(`chat-hand:1:${fightSeed}:${runFrom}`) % 100 < LATE_PERCENT;
    const want = tick === 1 ? true
      : state.phase === 'run' ? late || state.tension < 1_400
      : state.phase === 'warning' ? state.tension < 4_200
      : state.tension < 8_400;
    if (want !== reel) { inputs.push(Object.freeze({ tick, reel: want })); reel = want; }
    state = stepFight(state, reel);
  }
  if (!verifyFight({ seed: fightSeed, profile, inputs, throughTick: state.tick, claimed: state })) throw new Error('A chat fight did not replay.');
  return Object.freeze({ inputs: Object.freeze(inputs), result: state });
}

interface Line {
  readonly id: string; readonly personId: PersonId; readonly messageId: string; who: PierFeedWho;
  readonly seed: number; readonly float: Vec3; readonly anchor: Vec3; readonly at: number; readonly revision: number;
  readonly environment: FishingEnvironment; readonly fish: FishingRoll | null;
  phase: PierFeedLine['phase'] | 'keeping'; cancel: (() => void) | null;
}

/** Chat's floats at one kingdom's pier. Ephemeral: a restart loses only the floats in the water. */
export function createChatFishing(options: ChatFishingOptions) {
  const lines = new Map<string, Line>();
  const byPerson = new Map<PersonId, string>();
  const resting = new Map<PersonId, number>();
  const toldFull = new Map<PersonId, number>();
  let closed = false;
  const now = () => {
    const at = options.clock();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid chat fishing clock.');
    return at;
  };
  const view = (line: Line): PierFeedLine => ({ id: line.id, who: line.who, via: 'chat',
    phase: line.phase === 'keeping' ? 'fight' : line.phase, float: line.float, at: line.at });
  const publish = (event: PierFeedEvent) => { if (!closed) { try { options.publish(event); } catch { /* Watchers recover from the next snapshot. */ } } };
  const end = (line: Line, rest: boolean) => {
    line.cancel?.(); line.cancel = null;
    lines.delete(line.id);
    if (byPerson.get(line.personId) === line.id) byPerson.delete(line.personId);
    if (rest) resting.set(line.personId, now() + CHAT_COOLDOWN_MS);
  };
  const sweep = (at: number) => {
    for (const [person, until] of resting) if (until <= at) resting.delete(person);
    for (const [person, until] of toldFull) if (until <= at) toldFull.delete(person);
  };
  /** Off the end of the pier in a loose fan, over real open water a metre deep or more. */
  const place = (installation: FishingInstallation, seed: number): { float: Vec3; anchor: Vec3; depthM: number } | null => {
    const { site, sample } = installation, { right, out } = pierFrame(site);
    const at = (x: number, z: number): Vec3 => [site.root[0] + right[0] * x + out[0] * z, site.waterY, site.root[2] + right[2] * x + out[2] * z];
    const end = at(0, site.walk + 3.4), anchor: Vec3 = [end[0], site.deckY, end[2]];
    for (let attempt = 0; attempt < 16; attempt++) {
      const h = fishingHash(`chat-float:1:${seed}:${attempt}`);
      const across = ((h % 1000) / 1000 - .5) * 9, reach = 2.5 + (h >>> 10) % 1000 / 1000 * 5.5;
      const float = at(across, site.walk + 4 + reach);
      const water = sample(float[0], float[2]);
      if (water.waterY === null || !Number.isFinite(water.groundY) || Math.abs(water.waterY - site.waterY) > .001
        || water.waterY - water.groundY < 1) continue;
      if ([...lines.values()].some(line => Math.hypot(line.float[0] - float[0], line.float[2] - float[2]) < 1.3)) continue;
      return { float, anchor, depthM: water.waterY - water.groundY };
    }
    return null;
  };
  const keep = async (line: Line, candidate: ChatCatchCandidate, attempt = 0): Promise<void> => {
    let result: ChatKeepResult;
    try { result = await options.keep(candidate); } catch { result = { status: 'failed' }; }
    if (closed || lines.get(line.id) !== line) return;
    if (result.status === 'kept') {
      end(line, true);
      publish({ kind: 'caught', at: candidate.at, id: line.id, who: line.who, via: 'chat',
        fish: { speciesId: candidate.fish.speciesId, lengthMm: candidate.fish.lengthMm, weightG: candidate.fish.weightG },
        kingdomFirst: result.kingdomFirst, keepsake: result.keepsake, float: line.float });
      return;
    }
    // An uncertain or failed commit retries the same cast id; its receipt makes a retry safe.
    if (result.status !== 'refused' && attempt < 3) {
      line.cancel = options.schedule(() => { line.cancel = null; void keep(line, candidate, attempt + 1); }, 1500 * (attempt + 1));
      return;
    }
    end(line, true);
    publish({ kind: 'gone', at: now(), id: line.id, reason: 'unkept' });
  };
  const bite = (line: Line) => {
    line.cancel = null;
    if (closed || lines.get(line.id) !== line) return;
    if (!line.fish) { end(line, true); publish({ kind: 'gone', at: now(), id: line.id, reason: 'missed' }); return; }
    const species = options.species.get(line.fish.speciesId);
    line.phase = 'bite';
    publish({ kind: 'line', at: now(), line: view(line) });
    if (species?.legend) {
      // Too strong for a chat line: it takes the float and is gone. Only a walker's rod could have held it.
      line.cancel = options.schedule(() => {
        if (closed || lines.get(line.id) !== line) return;
        end(line, true);
        publish({ kind: 'broken', at: now(), id: line.id, who: line.who, speciesId: line.fish!.speciesId, float: line.float });
      }, BREAK_MS);
      return;
    }
    const fightSeed = fishingHash(`fight:1:${line.seed}`);
    const fight = chatFight(fightSeed, line.fish.fight);
    line.cancel = options.schedule(() => {
      line.cancel = null;
      if (closed || lines.get(line.id) !== line) return;
      line.phase = 'fight';
      publish({ kind: 'line', at: now(), line: view(line) });
      line.cancel = options.schedule(() => {
        line.cancel = null;
        if (closed || lines.get(line.id) !== line) return;
        if (fight.result.outcome !== 'landed') {
          end(line, true);
          publish({ kind: 'gone', at: now(), id: line.id, reason: fight.result.outcome === 'snapped' ? 'snapped' : 'escaped' });
          return;
        }
        line.phase = 'keeping';
        void keep(line, Object.freeze({ version: 1, castId: line.id, personId: line.personId, kingdomId: options.kingdomId,
          at: now(), float: line.float, anchor: line.anchor, collisionRevision: line.revision, environment: line.environment,
          fish: line.fish!, castSeed: line.seed, fightSeed, inputs: fight.inputs, result: fight.result }));
      }, fight.result.tick * FIGHT_TICK_MS + LAND_MS);
    }, 350);
  };

  return {
    /** `!fish` from a chatter with a lit window. Never grants anything itself. */
    cast(input: ChatCastInput): ChatCastOutcome {
      if (closed) return 'closed';
      const at = now();
      sweep(at);
      if (byPerson.has(input.personId)) return 'busy';
      if ((resting.get(input.personId) ?? 0) > at) return 'resting';
      const installation = options.installation();
      if (!installation) return 'closed';
      const who: PierFeedWho = Object.freeze({ name: input.name, slot: input.slot, colour: pierLightColour(input.slot) });
      if (lines.size >= CHAT_CAP || byPerson.size >= MAX_PEOPLE) {
        if (!toldFull.has(input.personId)) {
          if (toldFull.size >= MAX_PEOPLE) toldFull.delete(toldFull.keys().next().value!);
          toldFull.set(input.personId, at + CHAT_FULL_GAP_MS);
          publish({ kind: 'full', at, who, cap: CHAT_CAP });
        }
        return 'full';
      }
      const seed = options.seed(), id = options.makeId();
      if (!validFishingSeed(seed) || lines.has(id)) throw new Error('Invalid chat cast identity.');
      const placed = place(installation, seed);
      if (!placed) return 'full';
      const environment: FishingEnvironment = Object.freeze({ water: installation.site.water,
        biome: installation.biome === null ? 'unknown' : installation.biome, depthM: placed.depthM,
        hour: fishingHourBand(kingdomFishingHour(at)), mood: kingdomWaterMood(options.kingdomId, at) });
      const fish = options.species.roll(environment, fishingHash(`roll:1:${seed}`));
      const line: Line = { id, personId: input.personId, messageId: input.messageId, who, seed, float: Object.freeze(placed.float) as Vec3,
        anchor: Object.freeze(placed.anchor) as Vec3, at, revision: installation.revision, environment, fish, phase: 'float', cancel: null };
      lines.set(id, line); byPerson.set(input.personId, id);
      publish({ kind: 'line', at, line: view(line) });
      line.cancel = options.schedule(() => bite(line), WAIT_MIN_MS + fishingHash(`wait:1:${seed}`) % WAIT_SPAN_MS);
      return 'cast';
    },
    /** A deleted `!fish` pulls its float, unless the catch is already being kept. */
    remove(messageIds: readonly string[]): void {
      const ids = new Set(messageIds);
      for (const line of [...lines.values()]) if (ids.has(line.messageId) && line.phase !== 'keeping') {
        end(line, false); publish({ kind: 'gone', at: now(), id: line.id, reason: 'pulled' });
      }
    },
    /** A timeout or ban clears that person's line; a cleared chat clears every chat line. */
    clear(personId?: PersonId): void {
      for (const line of [...lines.values()]) if (personId === undefined || line.personId === personId) {
        // A catch already being written stays theirs, but a moderated person's name never reaches the stream.
        if (line.phase === 'keeping') { if (personId !== undefined) line.who = Object.freeze({ ...line.who, name: null }); continue; }
        end(line, personId !== undefined); publish({ kind: 'gone', at: now(), id: line.id, reason: 'cleared' });
      }
    },
    lines(): readonly PierFeedLine[] { return [...lines.values()].map(view); },
    dispose(): void {
      closed = true;
      for (const line of lines.values()) line.cancel?.();
      lines.clear(); byPerson.clear(); resting.clear(); toldFull.clear();
    },
  };
}
export type ChatFishing = ReturnType<typeof createChatFishing>;
