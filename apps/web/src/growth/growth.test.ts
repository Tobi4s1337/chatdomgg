import { describe, expect, it } from 'vitest';
import { GrowthHomeStageSchema, GrowthSceneFrameSchema, type GrowthSceneFrame } from '@chatdom/shared';
import { isStreamNight, simulateGrowthHistory } from './history';
import { beatKey, createCeremonyLedger, createRecordedGrowthFeed, type GrowthCeremony } from './ledger';
import { composeScore, numberWords, sampleScore } from './score';
import { neighbourHistory, planGrowthTown } from './town';

const rank = (stage: string) => GrowthHomeStageSchema.options.indexOf(stage as never);
const history = simulateGrowthHistory({ heroPlotId: 'plot:2025:9', neighbours: [{ plotId: 'plot:2025:10', installedTier: 'hut', attendance: .7 }] });

function ceremoniesOf(frames: readonly GrowthSceneFrame[]) {
  const ledger = createCeremonyLedger(), ceremonies: GrowthCeremony[] = [];
  for (const frame of frames) ceremonies.push(...ledger.accept(frame).ceremonies);
  return { ledger, ceremonies };
}

describe('the simulated year', () => {
  it('earns the hero every stage through the real reducer, in simulated frames only', () => {
    expect(history.frames.every(frame => GrowthSceneFrameSchema.safeParse(frame).success && frame.origin === 'simulated')).toBe(true);
    const grown = history.frames.flatMap(frame => frame.beats).filter(beat => beat.kind === 'home-grown' && beat.plotId === 'plot:2025:9');
    expect(grown.map(beat => beat.kind === 'home-grown' && [beat.from, beat.to, beat.qualifiedDays])).toEqual([
      ['tent', 'hut', 3], ['hut', 'cottage', 7], ['cottage', 'house', 30], ['house', 'manor', 90], ['manor', 'hall', 180]]);
    expect(history.frames.at(-1)!.homes.find(home => home.plotId === 'plot:2025:9')?.stage).toBe('hall');
    expect(new Date(history.frames.at(-1)!.asOf).getUTCFullYear()).toBe(2026);
  });

  it('keeps stream nights to five evenings a week with breaks', () => {
    const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
    expect(isStreamNight(day('2025-03-03'))).toBe(true);
    expect(isStreamNight(day('2025-03-07'))).toBe(false);
    expect(isStreamNight(day('2025-08-11'))).toBe(false);
    expect(isStreamNight(day('2025-12-24'))).toBe(false);
  });
});

describe('the ceremony ledger', () => {
  it('bootstraps quietly and celebrates each committed beat once', () => {
    const { ceremonies } = ceremoniesOf(history.frames);
    const keys = ceremonies.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ceremonies.filter(c => c.beat.kind === 'home-grown' && c.beat.plotId === 'plot:2025:9')).toHaveLength(5);
    // Joining late: the frame that carried the hut beat is the bootstrap, so the hut is shown, not celebrated.
    const hutAt = history.frames.findIndex(frame => frame.beats.some(beat => beat.kind === 'home-grown' && beat.to === 'hut'));
    const late = ceremoniesOf(history.frames.slice(hutAt));
    expect(late.ledger.stage('plot:2025:9')).toBe('hall');
    expect(late.ceremonies.some(c => c.beat.kind === 'home-grown' && c.beat.to === 'hut')).toBe(false);
  });

  it('never repeats a housewarming for a replayed frame and never lets a home shrink', () => {
    const ledger = createCeremonyLedger();
    const grown = history.frames.findIndex(frame => frame.beats.some(beat => beat.kind === 'home-grown' && beat.to === 'cottage'));
    ledger.accept(history.frames[0]);
    for (const frame of history.frames.slice(1, grown)) ledger.accept(frame);
    const first = ledger.accept(history.frames[grown]);
    expect(first.ceremonies.some(c => c.beat.kind === 'home-grown' && c.beat.to === 'cottage')).toBe(true);
    expect(ledger.accept(history.frames[grown]).ceremonies).toEqual([]);
    const regressed = { ...history.frames[grown]!, sequence: history.frames[grown]!.sequence + 1_000_000, beats: [],
      homes: history.frames[grown]!.homes.map(home => home.plotId === 'plot:2025:9' ? { ...home, stage: 'hut' as const } : home) };
    ledger.accept(regressed);
    expect(ledger.stage('plot:2025:9')).toBe('cottage');
    expect(ledger.accept({ ...regressed, kingdomId: '999', sequence: regressed.sequence + 1 }).accepted).toBe(false);
  });

  it('celebrates the committed geometry even when an eligibility frame already showed the stage', () => {
    const ledger = createCeremonyLedger();
    const grown = history.frames.findIndex(frame => frame.beats.some(beat => beat.kind === 'home-grown' && beat.to === 'cottage' && beat.plotId === 'plot:2025:9'));
    for (const frame of history.frames.slice(0, grown)) ledger.accept(frame);
    const committed = history.frames[grown]!;
    // The eligibility frame: the home's stage is already cottage, but no beat has been committed yet.
    expect(ledger.accept({ ...committed, beats: [] }).accepted).toBe(true);
    expect(ledger.stage('plot:2025:9')).toBe('cottage');
    const update = ledger.accept({ ...committed, sequence: committed.sequence + 1 });
    expect(update.ceremonies.filter(c => c.beat.kind === 'home-grown' && c.beat.plotId === 'plot:2025:9')).toHaveLength(1);
    // A later beat at the same stage with a new source sequence is not a second housewarming.
    const beat = committed.beats.find(b => b.kind === 'home-grown' && b.plotId === 'plot:2025:9')!;
    const again = ledger.accept({ ...committed, sequence: committed.sequence + 2, beats: [{ ...beat, sourceSeq: beat.sourceSeq + 1 }] });
    expect(again.accepted).toBe(true);
    expect(again.ceremonies).toEqual([]);
  });

  it('keys a beat by kingdom, source sequence, kind and target', () => {
    const beat = history.frames.flatMap(frame => frame.beats).find(item => item.kind === 'home-grown')!;
    expect(beatKey('41960001', beat)).toBe(`41960001/${beat.sourceSeq}/home-grown/${beat.kind === 'home-grown' ? beat.plotId : ''}`);
  });

  it('labels the recorded feed SIMULATED and refuses a live frame', () => {
    expect(createRecordedGrowthFeed(history.frames).label).toBe('SIMULATED');
    expect(() => createRecordedGrowthFeed([{ ...history.frames[0]!, origin: 'live' }])).toThrow();
  });
});

describe('the score', () => {
  const { ceremonies } = ceremoniesOf(history.frames);
  const score = composeScore({ heroPlotId: 'plot:2025:9', street: 'Copperleaf Lane', bootstrap: history.frames[0]!, ceremonies,
    quarter: { name: 'Willowbend', year: 2026, openedAt: history.frames.at(-1)!.asOf } });

  it('plays hut to hall, then the street, the new quarter and a closing hold', () => {
    expect(score.acts.map(act => act.kind)).toEqual(['open', 'grow', 'grow', 'grow', 'grow', 'grow', 'rise', 'quarter', 'close']);
    expect(score.acts.every((act, i) => i === 0 || act.start === score.acts[i - 1]!.end)).toBe(true);
    expect(score.acts[1]!.caption.line).toBe('Three nights in the kingdom. The first walls go up on the plot.');
    expect(score.acts[5]!.caption.line).toContain('A hundred and eighty nights');
    expect(score.duration).toBeGreaterThan(80);
    expect(score.duration).toBeLessThan(120);
  });

  it('only ever moves the home forward as time passes', () => {
    let last = -2;
    for (let t = 0; t <= score.duration; t += .25) {
      const shown = rank(sampleScore(score, t).hero.shown);
      expect(shown).toBeGreaterThanOrEqual(last);
      last = shown;
    }
    expect(sampleScore(score, 0).hero.shown).toBe('tent');
    expect(sampleScore(score, score.duration).hero.shown).toBe('hall');
  });

  it('shows neighbours who earned growth settling during the rise', () => {
    expect(score.neighbours.length).toBeGreaterThan(0);
    const rise = score.acts.find(act => act.kind === 'rise')!;
    expect(score.neighbours.every(n => n.start >= rise.start && n.end <= rise.end)).toBe(true);
  });

  it('says numbers as a chronicler does', () => {
    expect([3, 7, 30, 31, 90, 180, 365].map(numberWords)).toEqual(['three', 'seven', 'thirty', 'thirty-one', 'ninety', 'a hundred and eighty', 'three hundred and sixty-five']);
  });
});

describe('the growing town', () => {
  const town = planGrowthTown('hearthmoor', 2025);
  it('keeps every older plot where it was and opens a full quarter at the edge', () => {
    const after = new Map(town.after.homes.map(home => [home.id, home]));
    expect(town.before.homes.every(home => after.get(home.id)?.position.join() === home.position.join())).toBe(true);
    expect(town.quarter.homes.length).toBeGreaterThan(20);
    expect(town.quarter.streets.length).toBeGreaterThan(0);
    expect(town.hero.quarterYear).toBe(2025);
    // Every tier above the hut is the growth line's, so the cottage is the authored two-storey one.
    expect(town.hero.tier).toBe('hut');
    expect(town.before.homes.find(home => home.id === town.hero.id)?.tier).toBe('hut');
    expect(town.before.homes.every(home => home.style === 'hearth')).toBe(true);
  });
  it('gives the neighbours their installed homes as a floor', () => {
    expect(neighbourHistory(town).map(n => n.installedTier)).toEqual(town.neighbours.map(home => home.tier));
  });
}, 60_000);
