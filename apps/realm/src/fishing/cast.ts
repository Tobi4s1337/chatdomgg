import { FishingRequestSchema, fishingHash, fishingHourBand, kingdomFishingHour, kingdomWaterMood,
  type FishingEnvironment, type FishingPierSite, type FishingRoll, type PersonId, type KingdomId, type Vec3 } from '@chatdom/shared';
import type { RealmChannelPose } from '../room-channels';
import { aimFishingCast, onFishingLip, type FishingWaterSampler } from './cast-site';
import { createFight, stepFight, verifyFight, FIGHT_TICK_MS, MAX_FIGHT_TICKS, type FightInput, type FightState } from './fight';
import { validFishingSeed, type FishingSpecies } from './species';

export interface FishingSeat {
  readonly token: string; readonly pose: RealmChannelPose; readonly ownsRod: boolean;
  /** The rod's earned reach in metres (PI12); absent is none. */
  readonly reachM?: number;
}
export interface FishingInstallation {
  readonly site: FishingPierSite; readonly revision: number; readonly sample: FishingWaterSampler;
  /** Adopted recipe identity, never landscape character or inferred style. null allows wildcard habitats only. */
  readonly biome: string | null;
}
export type CastPhase = 'drawing' | 'flying' | 'waiting' | 'bite' | 'fighting' | 'landing';
export interface CastView {
  readonly id: string; readonly phase: CastPhase; readonly anchor: Vec3; readonly float: Vec3 | null;
  readonly at: number; readonly biteClosesAt?: number;
  readonly fight?: Pick<FightState, 'tick' | 'tension' | 'progress' | 'phase' | 'tired'>;
  readonly environment?: FishingEnvironment;
}
export interface FishingCandidate {
  readonly version: 1; readonly castId: string; readonly personId: PersonId; readonly kingdomId: KingdomId;
  readonly at: number; readonly float: Vec3; readonly environment: FishingEnvironment; readonly fish: FishingRoll;
  /** Private audit inputs, never a public feed payload. */
  readonly castSeed: number; readonly anchor: Vec3; readonly collisionRevision: number;
  readonly fightSeed: number; readonly inputs: readonly FightInput[]; readonly result: FightState;
}
export type CastBeat = { readonly castId: string; readonly at: number;
  readonly kind: 'draw' | 'cast' | 'float' | 'nibble' | 'bite' | 'hook' | 'pressure' | 'landing' | 'ended'; readonly reason?: string };
interface Cast {
  id: string; drawId: string; personId: PersonId; seat: string; anchor: Vec3; revision: number; site: FishingPierSite; biome: string;
  phase: CastPhase; at: number; lastSeq: number; seed: number; float: Vec3 | null; depthM: number;
  landedAt: number; biteAt: number; closesAt: number; nibbles: number; environment: FishingEnvironment | null;
  fish: FishingRoll | null; fight: FightState | null; fightAt: number; tape: FightInput[]; applied: number; held: boolean;
  candidate: FishingCandidate | null;
}
export interface FishingCastsOptions {
  readonly kingdomId: KingdomId; readonly clock: () => number; readonly species: FishingSpecies;
  /** Trusted ports: current authenticated controlling seat, owned equipped rod, adopted founded installation. */
  readonly seat: (personId: PersonId) => FishingSeat | null;
  readonly installation: () => FishingInstallation | null;
  readonly makeId: () => string; readonly seed: () => number;
}

const MAX_CASTS = 48, DRAW_EXPIRY = 5000, FLIGHT_MS = 650, LANDING_EXPIRY = 5000;
const installationBiome = (value: string | null) => value === null ? 'unknown' : typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && value !== 'unknown' ? value : null;
const copiedVec = (point: Vec3): Vec3 => Object.freeze([...point]) as Vec3;
const sameSite = (a: FishingPierSite, b: FishingPierSite) => a.id === b.id && a.turn === b.turn && a.walk === b.walk
  && a.deckY === b.deckY && a.waterY === b.waterY && a.root.every((n, i) => n === b.root[i]) && a.water === b.water;

/** Ephemeral server domain. No catch/grant capability and no client tape input. Restart loses only active casts. */
/** One reel edge at the fight's next tick: the last edge of a tick wins, and an unchanged state appends nothing. */
function reelTape(cast: Cast, on: boolean) {
  const nextTick = cast.fight!.tick + 1;
  if (cast.tape.at(-1)?.tick === nextTick) cast.tape.pop();
  const previous = cast.tape.at(-1)?.reel ?? false;
  if (on !== previous) cast.tape.push({ tick: nextTick, reel: on });
}

export function createFishingCasts(options: FishingCastsOptions) {
  const casts = new Map<PersonId, Cast>();
  let lastTime = 0, closed = false;
  const now = () => {
    const time = options.clock();
    if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid server fishing clock.');
    return lastTime = Math.max(lastTime, time);
  };
  const view = (cast: Cast): CastView => Object.freeze({ id: cast.id, phase: cast.phase, anchor: cast.anchor, float: cast.float, at: cast.at,
    ...(cast.phase === 'bite' ? { biteClosesAt: cast.closesAt } : {}),
    ...(cast.environment ? { environment: cast.environment } : {}),
    ...(cast.fight ? { fight: Object.freeze({ tick: cast.fight.tick, tension: cast.fight.tension, progress: cast.fight.progress,
      phase: cast.fight.phase, tired: cast.fight.tired }) } : {}),
  });
  const emit = (beats: CastBeat[], cast: Cast, kind: CastBeat['kind'], time: number, reason?: string) => {
    if (beats.length >= 256) throw new Error('Fishing beat bound exceeded.');
    beats.push(Object.freeze({ castId: cast.id, at: time, kind, ...(reason ? { reason } : {}) }));
  };
  const end = (cast: Cast, time: number, beats: CastBeat[], reason: string) => {
    casts.delete(cast.personId); emit(beats, cast, 'ended', time, reason);
  };
  const current = (cast: Cast) => {
    const seat = options.seat(cast.personId), installation = options.installation();
    if (!seat || seat.token !== cast.seat || !seat.ownsRod || !installation || installation.revision !== cast.revision
      || !onFishingLip(installation.site, seat.pose, installation.revision) || !sameSite(cast.site, installation.site)
      || installationBiome(installation.biome) !== cast.biome
      || Math.hypot(seat.pose.position[0] - cast.anchor[0], seat.pose.position[2] - cast.anchor[2]) > .8) return null;
    return { seat, installation };
  };
  const advance = (cast: Cast, time: number, beats: CastBeat[]) => {
    if (!current(cast)) { end(cast, time, beats, 'Your line is reeled in.'); return; }
    if (cast.phase === 'drawing') {
      if (time - cast.at >= DRAW_EXPIRY) end(cast, time, beats, 'The rod is lowered.');
      return;
    }
    if (cast.phase === 'landing') {
      if (time - cast.at >= LANDING_EXPIRY) end(cast, time, beats, 'The catch could not be kept.');
      return;
    }
    if (cast.phase === 'flying' && time >= cast.landedAt) {
      cast.phase = 'waiting'; cast.at = cast.landedAt;
      cast.environment = Object.freeze({ water: cast.site.water, biome: cast.biome, depthM: cast.depthM,
        hour: fishingHourBand(kingdomFishingHour(cast.landedAt)), mood: kingdomWaterMood(options.kingdomId, cast.landedAt) });
      cast.fish = options.species.roll(cast.environment, fishingHash(`roll:1:${cast.seed}`));
      if (!cast.fish) { end(cast, time, beats, 'Nothing is biting in this water.'); return; }
      const wait = 4000 + fishingHash(`wait:1:${cast.seed}`) % 7001;
      cast.biteAt = cast.landedAt + wait; cast.closesAt = cast.biteAt + cast.fish.strikeMs;
      emit(beats, cast, 'float', cast.landedAt);
    }
    if (cast.phase === 'waiting') {
      const wait = cast.biteAt - cast.landedAt;
      const nibbleTimes = [cast.landedAt + Math.floor(wait * .45), cast.landedAt + Math.floor(wait * .76)];
      while (cast.nibbles < 2 && time >= nibbleTimes[cast.nibbles]!) emit(beats, cast, 'nibble', nibbleTimes[cast.nibbles++]!);
      if (time >= cast.biteAt) { cast.phase = 'bite'; cast.at = cast.biteAt; emit(beats, cast, 'bite', cast.biteAt); }
    }
    if (cast.phase === 'bite' && time >= cast.closesAt) { end(cast, cast.closesAt, beats, 'The fish slipped away.'); return; }
    if (cast.phase !== 'fighting' || !cast.fight || !cast.fish) return;
    const through = Math.min(MAX_FIGHT_TICKS, Math.floor((time - cast.fightAt) / FIGHT_TICK_MS));
    const oldPhase = cast.fight.phase, oldTired = cast.fight.tired;
    while (cast.fight.tick < through && cast.fight.outcome === 'active') {
      const edge = cast.tape[cast.applied];
      if (edge?.tick === cast.fight.tick + 1) { cast.held = edge.reel; cast.applied++; }
      cast.fight = stepFight(cast.fight, cast.held);
    }
    if (cast.fight.outcome === 'active') {
      if (cast.fight.phase !== oldPhase || cast.fight.tired !== oldTired) emit(beats, cast, 'pressure', time);
      return;
    }
    const resolvedAt = cast.fightAt + cast.fight.tick * FIGHT_TICK_MS;
    if (cast.fight.outcome !== 'landed') { end(cast, resolvedAt, beats, cast.fight.outcome === 'snapped' ? 'The line snapped.' : 'The fish slipped the hook.'); return; }
    const fightSeed = fishingHash(`fight:1:${cast.seed}`);
    if (!verifyFight({ seed: fightSeed, profile: cast.fish.fight, inputs: cast.tape, throughTick: cast.fight.tick, claimed: cast.fight })) {
      end(cast, resolvedAt, beats, 'The catch could not be confirmed.'); return;
    }
    cast.phase = 'landing'; cast.at = resolvedAt;
    cast.candidate = Object.freeze({ version: 1, castId: cast.id, personId: cast.personId, kingdomId: options.kingdomId,
      at: resolvedAt, float: cast.float!, environment: cast.environment!, fish: cast.fish, fightSeed, castSeed: cast.seed,
      anchor: cast.anchor, collisionRevision: cast.revision,
      inputs: Object.freeze(cast.tape.map(edge => Object.freeze({ ...edge }))), result: cast.fight });
    emit(beats, cast, 'landing', resolvedAt);
    if (time - resolvedAt >= LANDING_EXPIRY) end(cast, time, beats, 'The catch could not be kept.');
  };
  const tick = () => {
    const beats: CastBeat[] = [];
    if (!closed) { const time = now(); for (const cast of casts.values()) advance(cast, time, beats); }
    return beats as readonly CastBeat[];
  };
  return {
    tick,
    act(personId: PersonId, raw: unknown): { readonly ok: boolean; readonly message?: string; readonly cast: CastView | null; readonly beats: readonly CastBeat[] } {
      const beats: CastBeat[] = [];
      const refuse = (message: string) => ({ ok: false, message, cast: casts.has(personId) ? view(casts.get(personId)!) : null, beats });
      if (closed) return refuse('The pier has closed.');
      const parsed = FishingRequestSchema.safeParse(raw);
      if (!parsed.success) return refuse('That fishing action is not understood.');
      const request = parsed.data, time = now();
      let cast = casts.get(personId);
      if (cast) { advance(cast, time, beats); cast = casts.get(personId); }
      if (request.type === 'pier.draw') {
        if (cast) return cast.drawId === request.id ? { ok: true, cast: view(cast), beats } : refuse('You already have a line out.');
        // Reap expired seats before testing the cap; no dormant map grows behind this bound.
        for (const other of casts.values()) advance(other, time, beats);
        if (casts.size >= MAX_CASTS) return refuse('The pier is full just now.');
        const seat = options.seat(personId), installation = options.installation();
        if (!seat?.ownsRod) return refuse('Take a rod from the rack first.');
        if (!installation || !onFishingLip(installation.site, seat.pose, installation.revision)) return refuse('Stand at the end of the pier to cast.');
        const biome = installationBiome(installation.biome);
        if (biome === null) return refuse('The kingdom could not read this water.');
        const id = options.makeId(), seed = options.seed();
        // Validate generated identifiers too: malformed server configuration never creates an unreachable cast.
        if (!FishingRequestSchema.safeParse({ type: 'pier.cancel', id: request.id, castId: id, seq: 1 }).success || !validFishingSeed(seed)
          || [...casts.values()].some(other => other.id === id)) throw new Error('Invalid server cast identity.');
        const site = Object.freeze({ ...installation.site, root: copiedVec(installation.site.root), depth: Object.freeze([...installation.site.depth]) });
        cast = { id, seed, biome, drawId: request.id, personId, seat: seat.token, anchor: copiedVec(seat.pose.position), revision: installation.revision,
          site, phase: 'drawing', at: time, lastSeq: 0, float: null, depthM: 0, landedAt: 0, biteAt: 0, closesAt: 0, nibbles: 0,
          environment: null, fish: null, fight: null, fightAt: 0, tape: [], applied: 0, held: false, candidate: null };
        casts.set(personId, cast); emit(beats, cast, 'draw', time);
      } else {
        if (!cast || request.castId !== cast.id) return refuse('That line is no longer out.');
        if (request.seq <= cast.lastSeq) return { ok: true, cast: view(cast), beats };
        cast.lastSeq = request.seq;
        if (request.type === 'pier.cancel') { end(cast, time, beats, 'Your line is reeled in.'); return { ok: true, cast: null, beats }; }
        if (request.type === 'pier.release') {
          if (cast.phase !== 'drawing') return refuse('Your line is already out.');
          const status = current(cast)!;
          const aim = aimFishingCast(cast.site, status.seat.pose, cast.revision, time - cast.at, status.installation.sample, status.seat.reachM ?? 0);
          if (!aim.ok) { end(cast, time, beats, aim.message); return refuse(aim.message); }
          cast.float = copiedVec(aim.float); cast.depthM = aim.depthM; cast.phase = 'flying'; cast.at = time; cast.landedAt = time + FLIGHT_MS;
          emit(beats, cast, 'cast', time);
        } else if (request.type === 'pier.strike' && (cast.phase === 'fighting' || cast.phase === 'landing')) {
          // A second press on a fish already hooked (a double click, or a strike crossing its own answer) is a reel,
          // never a miss: the fish on the line is never lost to the button being pressed again.
          if (cast.phase === 'fighting' && cast.fight) reelTape(cast, true);
        } else if (request.type === 'pier.strike') {
          if (cast.phase !== 'bite' || !cast.fish) { end(cast, time, beats, 'The hook came back empty.'); return refuse('Wait for the float to dip.'); }
          cast.phase = 'fighting'; cast.at = time; cast.fightAt = time;
          cast.fight = createFight(fishingHash(`fight:1:${cast.seed}`), cast.fish.fight);
          // Strike starts the reel; release is still an explicit accepted edge.
          cast.tape.push({ tick: 1, reel: true }); emit(beats, cast, 'hook', time);
        } else {
          if (cast.phase !== 'fighting' || !cast.fight) return refuse('There is no fish on the line.');
          reelTape(cast, request.on);
        }
      }
      return { ok: true, cast: view(cast), beats };
    },
    /** Trusted writer only. Revalidates expiry/seat before handing out an immutable candidate, never a grant. */
    candidate(personId: PersonId): FishingCandidate | null {
      if (closed) return null;
      const cast = casts.get(personId);
      if (!cast || cast.phase !== 'landing' || now() - cast.at >= LANDING_EXPIRY || !current(cast)) return null;
      return cast.candidate;
    },
    views(): readonly CastView[] { return [...casts.values()].map(view); },
    /** Writer calls only after confirmed commit (or rollback). Does not publish catch success itself. */
    finish(personId: PersonId, castId: string): boolean {
      if (casts.get(personId)?.id !== castId) return false;
      casts.delete(personId); return true;
    },
    dispose() { closed = true; casts.clear(); },
  };
}
