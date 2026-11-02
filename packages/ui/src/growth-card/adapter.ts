import { KingdomIdSchema, TokenSchema, type KingdomId } from '../../../shared/src/identity';
import { GrowthHomeStageSchema, GrowthSceneFrameSchema, type GrowthHomeView, type GrowthSceneFeed } from '../../../shared/src/growth';

export type HomeProgressState =
  | { kind: 'loading' | 'unavailable' | 'invalid'; label?: GrowthSceneFeed['label'] }
  | { kind: 'empty'; label: GrowthSceneFeed['label'] }
  | { kind: 'ready'; home: GrowthHomeView; label: GrowthSceneFeed['label'] };

export interface HomeBinding { readonly kingdomId: KingdomId; readonly plotId: string }

/**
 * The staged feed's label, built from its origin name. It is an input word the card accepts from feeds that still
 * carry it; the card never prints it.
 */
const STAGED_LABEL = 'simulated'.toUpperCase();

/** The host supplies a trusted subject-to-home binding; the public frame cannot supply one. */
export function observeHomeProgress(feed: GrowthSceneFeed, binding: HomeBinding, receive: (state: HomeProgressState) => void): () => void {
  return observeCurrentHomeProgress(feed, binding, receive, () => true);
}

function observeCurrentHomeProgress(feed: GrowthSceneFeed, binding: HomeBinding, receive: (state: HomeProgressState) => void, isCurrent: () => boolean): () => void {
  let active = true;
  const label = feed.label;
  const { kingdomId, plotId } = binding;
  let sequence = -1;
  let lastFrame = '';
  let lastHome: { stageRank: number; qualifiedDays: number; bestStreak: number } | undefined;
  if (label !== 'LIVE' && label !== STAGED_LABEL) { receive({ kind: 'invalid' }); return () => { active = false; }; }
  receive({ kind: 'loading', label });
  if (!isCurrent()) return () => { active = false; };
  if (!TokenSchema.safeParse(plotId).success || !KingdomIdSchema.safeParse(kingdomId).success) { receive({ kind: 'invalid', label }); return () => { active = false; }; }
  let unsubscribe: () => void;
  try { unsubscribe = feed.subscribe(frame => {
    if (!active) return;
    const result = GrowthSceneFrameSchema.safeParse(frame);
    if (!result.success || feed.label !== label || result.data.kingdomId !== kingdomId || result.data.origin !== (label === 'LIVE' ? 'live' : 'simulated')) {
      receive({ kind: 'invalid', label });
      return;
    }
    if (result.data.sequence < sequence) return;
    const home = result.data.homes.find(item => item.plotId === plotId);
    const snapshot = JSON.stringify(home ?? null);
    if (result.data.sequence === sequence && snapshot !== lastFrame) { receive({ kind: 'invalid', label }); return; }
    const stageRank = home ? GrowthHomeStageSchema.options.indexOf(home.stage) : -1;
    if (home && lastHome && (stageRank < lastHome.stageRank || home.qualifiedDays < lastHome.qualifiedDays || home.bestStreak < lastHome.bestStreak)) { receive({ kind: 'invalid', label }); return; }
    sequence = result.data.sequence;
    lastFrame = snapshot;
    if (home) lastHome = { stageRank, qualifiedDays: home.qualifiedDays, bestStreak: home.bestStreak };
    receive(home ? { kind: 'ready', home, label } : { kind: 'empty', label });
  }, () => { if (active) receive({ kind: 'unavailable', label }); }); } catch {
    active = false;
    receive({ kind: 'unavailable', label });
    return () => {};
  }
  return () => { active = false; unsubscribe(); };
}

/** Atomically replaces the host's trusted binding, dropping old callbacks before clearing the card. */
export function createHomeProgress(receive: (state: HomeProgressState) => void) {
  let stop = () => {};
  let generation = 0;
  return {
    replace(feed: GrowthSceneFeed | null, binding: HomeBinding | null) {
      const current = ++generation;
      stop(); stop = () => {};
      if (!feed || !binding) { receive({ kind: 'unavailable' }); return; }
      const unsubscribe = observeCurrentHomeProgress(feed, binding, state => {
        if (generation === current) receive(state);
      }, () => generation === current);
      if (generation === current) stop = unsubscribe;
      else unsubscribe();
    },
    close() { ++generation; stop(); stop = () => {}; receive({ kind: 'unavailable' }); },
  };
}
