import type { CommittedForgeAttachment, ForgeActivity } from '@chatdom/shared/realm';
import type { RealmForgeFeed } from '../../realm/adapters/forge-feed';

type Stage = Extract<ForgeActivity, { type: 'stage' }>['stage'];

/** Whether this person has a home a wish could land on, from the room's private `home.owned` (never a guess). */
export type AnvilHome = 'owned' | 'none' | 'unknown';

/**
 * What is true at the hero anvil right now, from the kingdom's actual Forge feed: whether the room is heard at all,
 * whether someone's wish is in the fire (its stage only: no words, no maker until it lands), the piece that just
 * landed, and how many made here stand in the kingdom. Nothing here is a coal balance or a promise.
 */
export interface AnvilState {
  readonly heard: 'waiting' | 'listening' | 'unavailable';
  readonly working: Stage | null;
  readonly landed: { readonly maker: string; readonly simulated: boolean } | null;
  readonly standing: number;
  readonly latest: { readonly maker: string; readonly simulated: boolean } | null;
}

export const ANVIL_WAITING: AnvilState = Object.freeze({ heard: 'waiting', working: null, landed: null, standing: 0, latest: null });

/** A landed piece is news for this long at the anvil; after that it simply stands with the others. */
export const LANDED_MS = 20_000;

export interface AnvilWatch {
  state(): AnvilState;
  subscribe(listener: (state: AnvilState) => void): () => void;
  dispose(): void;
}

/**
 * Watch the kingdom's `RealmForgeFeed` for the anvil card. One watch per visit: subscribing replays what the feed
 * already knows (standing parts, a ritual in progress), so the card opens on the truth rather than a blank.
 */
export function watchAnvil(feed: Pick<RealmForgeFeed, 'subscribe'>, clock: () => number = Date.now): AnvilWatch {
  let state: AnvilState = ANVIL_WAITING;
  const listeners = new Set<(state: AnvilState) => void>();
  const working = new Map<string, Stage>();
  const standing = new Map<string, CommittedForgeAttachment>();
  let landed: { maker: string; simulated: boolean; until: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const latestOf = () => {
    let best: CommittedForgeAttachment | null = null;
    for (const part of standing.values()) if (!best || part.committedAt > best.committedAt) best = part;
    return best ? { maker: best.provenance.makerName, simulated: best.provenance.source === 'simulated' } : null;
  };
  const emit = (heard: AnvilState['heard'] = state.heard) => {
    if (disposed) return;
    if (landed && landed.until <= clock()) landed = null;
    const stage = [...working.values()].at(-1) ?? null;
    state = Object.freeze({ heard, working: stage, landed: landed && { maker: landed.maker, simulated: landed.simulated }, standing: standing.size, latest: latestOf() });
    for (const listener of [...listeners]) listener(state);
  };
  const stop = feed.subscribe({
    restored(parts) { standing.clear(); for (const part of parts) standing.set(part.id, part); emit('listening'); },
    stage(activityId, stage) { working.set(activityId, stage); emit('listening'); },
    committed(part, activityId) {
      working.delete(activityId); standing.set(part.id, part);
      landed = { maker: part.provenance.makerName, simulated: part.provenance.source === 'simulated', until: clock() + LANDED_MS };
      clearTimeout(timer); timer = setTimeout(() => emit(), LANDED_MS);
      emit('listening');
    },
    // Present-tense activity is no longer confirmed: drop the fire's work in progress, never invent an outcome.
    unavailable() { working.clear(); landed = null; emit('unavailable'); },
  });
  return {
    state: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    dispose() { if (disposed) return; disposed = true; clearTimeout(timer); stop(); listeners.clear(); },
  };
}

/** One plain sentence for the fire's state, for the card and for screen readers. Never a raw stage name. */
export function anvilLine(state: AnvilState): string {
  if (state.heard === 'unavailable') return 'The anvil cannot hear the kingdom just now, so it cannot show the fire’s work.';
  if (state.heard === 'waiting') return 'Listening for the fire…';
  if (state.landed) return `${state.landed.maker}’s piece just found its home.`;
  if (state.working) return ({
    'judging-words': 'A wish is in the fire: its words are being weighed.',
    drafting: 'A wish is in the fire: the smith is drawing it.',
    assembling: 'A wish is in the fire: a shape is finding its place.',
    'judging-piece': 'A wish is in the fire: the seal is weighing the piece.',
  } satisfies Record<Stage, string>)[state.working];
  return 'The fire is awake. The smith is listening to chat.';
}

/** Where a wish lands, honestly: only the room's own answer about your home is used. */
export function anvilHomeLine(home: AnvilHome): string | null {
  if (home === 'owned') return 'It lands on your home, made in this kingdom’s style.';
  if (home === 'none') return 'A wish lands on its maker’s home, and you do not have one in this kingdom yet.';
  return null;
}
