import { GrowthHomeStageSchema, GrowthSceneFrameSchema, type GrowthHomeStage, type GrowthSceneBeat, type GrowthSceneFeed, type GrowthSceneFrame } from '@chatdom/shared';

/** One celebration owed to the town: a committed beat seen for the first time, with the frame that carried it. */
export interface GrowthCeremony {
  readonly key: string;
  readonly beat: GrowthSceneBeat;
  readonly frame: GrowthSceneFrame;
}
export interface LedgerUpdate {
  /** Forward-only stages after this frame. A stage never falls, even if a later frame claims less. */
  readonly stages: ReadonlyMap<string, GrowthHomeStage>;
  readonly ceremonies: readonly GrowthCeremony[];
  readonly accepted: boolean;
}

/** A beat is owed once per kingdom, source sequence, kind and target, so a repeated frame never repeats a housewarming. */
export function beatKey(kingdomId: string, beat: GrowthSceneBeat): string {
  return `${kingdomId}/${beat.sourceSeq}/${beat.kind}/${beat.kind === 'civic-levelled' ? beat.place : beat.plotId}`;
}

const rank = (stage: GrowthHomeStage) => GrowthHomeStageSchema.options.indexOf(stage);
const REMEMBERED = 1024;

/**
 * Consumes a growth feed in delivery order. The first frame is a quiet bootstrap: its recent beats already happened
 * before anyone was watching, so they set the stage without a ceremony. Older or foreign frames are ignored.
 */
export function createCeremonyLedger() {
  let kingdomId: string | null = null, sequence = -1;
  const stages = new Map<string, GrowthHomeStage>();
  const seen = new Set<string>(), order: string[] = [];
  const remember = (key: string) => {
    seen.add(key); order.push(key);
    while (order.length > REMEMBERED) seen.delete(order.shift()!);
  };
  return {
    accept(input: unknown): LedgerUpdate {
      const parsed = GrowthSceneFrameSchema.safeParse(input);
      if (!parsed.success) return { stages, ceremonies: [], accepted: false };
      const frame = parsed.data;
      if (kingdomId !== null && frame.kingdomId !== kingdomId || frame.sequence <= sequence) return { stages, ceremonies: [], accepted: false };
      const bootstrap = kingdomId === null;
      kingdomId = frame.kingdomId; sequence = frame.sequence;
      const before = new Map(stages);
      for (const home of frame.homes) {
        const known = stages.get(home.plotId);
        if (!known || rank(home.stage) > rank(known)) stages.set(home.plotId, home.stage);
      }
      const ceremonies: GrowthCeremony[] = [];
      for (const beat of frame.beats) {
        const key = beatKey(frame.kingdomId, beat);
        if (seen.has(key)) continue;
        remember(key);
        if (bootstrap) continue;
        // A home beat that does not move this home forward from what was already shown has nothing to celebrate.
        if (beat.kind === 'home-grown' && before.has(beat.plotId) && rank(beat.to) <= rank(before.get(beat.plotId)!)) continue;
        ceremonies.push({ key, beat, frame });
      }
      return { stages, ceremonies, accepted: true };
    },
    get kingdomId() { return kingdomId; },
    stage(plotId: string): GrowthHomeStage | undefined { return stages.get(plotId); },
  };
}

/** The bench's labelled feed: a recorded SIMULATED history delivered in order. It never claims to be live. */
export function createRecordedGrowthFeed(frames: readonly GrowthSceneFrame[]): GrowthSceneFeed {
  if (frames.some(frame => frame.origin !== 'simulated')) throw new Error('A recorded bench history must be simulated.');
  return {
    label: 'SIMULATED',
    subscribe(receive) {
      let open = true;
      for (const frame of frames) { if (!open) break; receive(frame); }
      return () => { open = false; };
    },
  };
}
