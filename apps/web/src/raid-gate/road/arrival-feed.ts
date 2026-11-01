import { TwitchMomentFactSchema, type MomentResetInfo, type TwitchMomentFact, type TwitchMomentFeed } from '@chatdom/shared/twitch-moments';

/**
 * The destination kingdom's own raid arrival, fed from the road. The kingdom scene already knows how an incoming raid
 * looks (twitch-moments: the gate wakes under the raider's banner, its braziers catch, the caravan rolls in through it
 * and the camera holds the gate); this feed hands it the one raid the road carried, so the guests arrive in the world,
 * under its own light, rather than in a drawing laid over it.
 *
 * It is a SIMULATED feed: the scene accepts its facts only as `simulated` and the route labels everything so. A live
 * kingdom gets the same fact from its realm's moment feed (main's ingress), never from here.
 */

export interface RoadRaid {
  /** The witnessed raid's own ID (the gate's authority gave it); one arrival per raid. */
  readonly raidId: string;
  /** The destination kingdom, whose feed this is. */
  readonly kingdomId: string;
  readonly from: { readonly kingdomId: string; readonly name: string };
  /** Twitch's own viewer count for the raid; it only sizes the caravan. */
  readonly viewers: number;
  /** Whether the leaving channel has a kingdom of its own here. */
  readonly founded: boolean;
}

export interface RoadArrivalFeed extends TwitchMomentFeed {
  /** Hand the scene this raid at `atMs` (the scene's presentation clock). Once per raid ID; later calls are ignored. */
  arrive(raid: RoadRaid, atMs: number): boolean;
  /** The fact handed over, if any. */
  readonly delivered: TwitchMomentFact | null;
}

/** How long the arrival may still begin after its cause; the kingdom's own window is five minutes. */
const DISPLAY_MS = 90_000;
const token = (value: string) => value.replace(/[^A-Za-z0-9_.:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 96) || 'raid';

/** The moment fact for a raid the road carried in, checked against the shared contract. */
export function arrivalFact(raid: RoadRaid, atMs: number, seq = 1): TwitchMomentFact {
  const key = token(raid.raidId);
  const at = Math.floor(atMs);
  return TwitchMomentFactSchema.parse({
    version: 1, kingdomId: raid.kingdomId, seq, occurredAt: at, receivedAt: at, committedAt: at, origin: 'simulated', type: 'twitch.moment',
    actor: null, cause: { kind: 'external', source: 'twitch', id: `raid-${key}` },
    body: { kind: 'raid', key: `raid.${key}`, displayUntil: at + DISPLAY_MS, raidKey: key,
      from: { kingdomId: raid.from.kingdomId, displayName: raid.from.name.slice(0, 64), crestKey: null },
      viewers: Math.max(1, Math.min(10_000_000, Math.floor(raid.viewers))), founded: raid.founded },
  });
}

export function createRoadArrivalFeed(epoch = 'raid-road'): RoadArrivalFeed {
  type Listener = { receive: (epoch: string, fact: TwitchMomentFact) => void };
  const listeners = new Set<Listener>();
  let delivered: TwitchMomentFact | null = null;
  return {
    origin: 'simulated',
    get delivered() { return delivered; },
    subscribe(reset, receive) {
      // The scene starts from an empty present: nothing has arrived before the road brings it.
      const info: MomentResetInfo = { epoch, asOf: delivered ? delivered.occurredAt : Date.now(), throughSeq: 0, current: [] };
      reset(info);
      const listener: Listener = { receive };
      listeners.add(listener);
      if (delivered) receive(epoch, delivered);
      return () => { listeners.delete(listener); };
    },
    arrive(raid, atMs) {
      if (delivered) return false;
      delivered = arrivalFact(raid, atMs);
      for (const each of listeners) each.receive(epoch, delivered);
      return true;
    },
  };
}
