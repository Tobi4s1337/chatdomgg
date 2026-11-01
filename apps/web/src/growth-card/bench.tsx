import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { KingdomIdSchema } from '../../../../packages/shared/src/identity';
import type { GrowthSceneFeed, GrowthSceneFrame } from '../../../../packages/shared/src/growth';
import { HomeProgress } from '../../../../packages/ui/src/growth-card/HomeProgress';
import { createHomeProgress, type HomeProgressState } from '../../../../packages/ui/src/growth-card/adapter';

const complete = new URLSearchParams(location.search).get('home') === 'complete';
const kingdomId = KingdomIdSchema.parse('123');
const frame: GrowthSceneFrame = { version: 1, kingdomId, origin: 'simulated', sequence: 1, asOf: 1, homes: [{ plotId: 'home', stage: complete ? 'hall' : 'cottage', qualifiedDays: 18, qualifiedMinutes: 180, currentStreak: 4, bestStreak: 9, nextGoal: complete ? null : { stage: 'house', requiredDays: 30, remainingDays: 12 } }], civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] };
let firstReceive: ((value: GrowthSceneFrame) => void) | undefined;
const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(receive) { firstReceive = receive; receive(frame); return () => {}; } };
type BenchControls = { replace(): void; late(): void; empty(): void; unavailable(): void };
function Bench() {
  const [state, setState] = createSignal<HomeProgressState>({ kind: 'loading' });
  const progress = createHomeProgress(setState);
  progress.replace(feed, { kingdomId, plotId: 'home' });
  let replacementReceive: ((value: GrowthSceneFrame) => void) | undefined;
  const controls: BenchControls = {
    replace() { progress.replace({ label: 'SIMULATED', subscribe(receive) { replacementReceive = receive; return () => {}; } }, { kingdomId, plotId: 'other' }); },
    late() { firstReceive?.(frame); },
    empty() { replacementReceive?.({ ...frame, sequence: 2, homes: [] }); },
    unavailable() { progress.replace(null, null); },
  };
  (window as Window & { __growthCardBench?: BenchControls }).__growthCardBench = controls;
  onCleanup(() => { delete (window as Window & { __growthCardBench?: BenchControls }).__growthCardBench; progress.close(); });
  return <main style={{ display: 'grid', 'place-items': 'center', 'min-height': '100vh', padding: '20px' }}><HomeProgress state={state()} /></main>;
}
render(() => <Bench />, document.getElementById('app')!);
