import { GrowthSceneBeatSchema, type GrowthSceneBeat, type GrowthSceneFrame } from '@chatdom/shared';

/** A presentation candidate, not a delivery receipt or permission to send. */
export interface GrowthCrierLine {
  readonly origin: GrowthSceneFrame['origin'];
  readonly text: string;
  readonly evidence: GrowthSceneBeat;
}

const places = {
  tavern: 'tavern',
  forge: 'forge',
  market: 'market',
  bridge: 'bridge',
  'castle-court': 'castle court',
} as const;

/** Format one witnessed public beat. Plot IDs are deliberately never treated as names. */
export function formatGrowthBeat(beat: GrowthSceneBeat, origin: GrowthSceneFrame['origin']): GrowthCrierLine {
  const evidence = GrowthSceneBeatSchema.parse(beat);
  let line: string;
  switch (evidence.kind) {
    case 'home-grown':
      line = `A home has grown from ${evidence.from} to ${evidence.to}.`;
      break;
    case 'civic-levelled':
      line = `The ${places[evidence.place]} has grown from level ${evidence.from} to ${evidence.to}.`;
      break;
    case 'streak-reached':
      line = `A citizen has reached a ${evidence.days}-day streak.`;
      break;
  }
  return { origin, text: origin === 'simulated' ? `SIMULATED: ${line}` : line, evidence };
}
