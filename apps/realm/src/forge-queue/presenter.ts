import type { KingdomId } from '@chatdom/shared';
import type { ForgeTransientActivity } from '@chatdom/shared/realm';

type Stage = Extract<ForgeTransientActivity, { type: 'stage' }>['stage'];
export interface ForgeLineEntry {
  readonly kingdomId: KingdomId;
  readonly key: string;
  /** The opaque attempt ID: the same activity ID the stages and the durable reveal carry. */
  readonly attemptId: string;
  readonly personId: string;
  readonly sequence: number;
}
interface Entry extends ForgeLineEntry {
  stage?: Stage;
  /** When this wish's ritual was first shown at the anvil (its turn began). */
  shownAt?: number;
}

/** The shortest time a wish's turn at the anvil is on view before its piece may land, so no turn is skipped unseen. */
export const FORGE_RITUAL_MIN_MS = 3_000;
/**
 * An optional pause after a piece lands before the next turn is shown. The client already plays each committed
 * ritual and its flight home in full, one after another, so the realm adds no pause by default.
 */
export const FORGE_REVEAL_MS = 0;

/**
 * One ritual at a time per kingdom, in the order the wishes were accepted. Several wishes may be drafted at
 * once; only the head of each kingdom's line reaches the room. The others keep their latest stage here and
 * show it the moment their turn comes. Present-tense stages and endings only: the durable outbox remains the
 * sole publisher of a reveal, so a restart never replays one.
 */
export class ForgeRitualPresenter {
  private readonly lines = new Map<KingdomId, Entry[]>();
  /** A kingdom whose last piece is still flying home: the next ritual waits until this time. */
  private readonly revealing = new Map<KingdomId, { readonly until: number; readonly timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly options: {
    readonly publish: (kingdomId: KingdomId, event: ForgeTransientActivity) => void;
    readonly now?: () => number;
    readonly minimumMs?: number;
    readonly revealMs?: number;
  }) {}

  /** Add an accepted wish in sequence order. Idempotent. */
  track(entry: ForgeLineEntry): void {
    const line = this.lines.get(entry.kingdomId) ?? [];
    if (line.some(item => item.key === entry.key)) return;
    const wasEmpty = line.length === 0;
    line.push({ ...entry });
    line.sort((a, b) => a.sequence - b.sequence);
    this.lines.set(entry.kingdomId, line);
    if (wasEmpty || line[0]!.key === entry.key) this.turn(entry.kingdomId);
  }

  /** A stage from the coordinator. Shown now only when this wish holds the anvil; otherwise kept for its turn. */
  offer(kingdomId: KingdomId, event: ForgeTransientActivity): void {
    const line = this.lines.get(kingdomId), entry = line?.find(item => item.attemptId === event.activityId);
    if (!line || !entry) return;
    if (event.type === 'ended') { this.finish(kingdomId, entry.key, false); return; }
    entry.stage = event.stage;
    if (line[0] === entry && !this.revealing.has(kingdomId)) this.show(entry);
  }

  /** The wish ended (landed, stopped or held). A shown ritual that did not land ends quietly; the next one begins. */
  finish(kingdomId: KingdomId, key: string, landed: boolean): void {
    const line = this.lines.get(kingdomId);
    const index = line?.findIndex(item => item.key === key) ?? -1;
    if (!line || index < 0) return;
    const [entry] = line.splice(index, 1);
    if (entry?.shownAt !== undefined && !landed) this.emit(kingdomId, { type: 'ended', activityId: entry.attemptId });
    if (index === 0 && landed) this.reveal(kingdomId);
    if (!line.length) this.lines.delete(kingdomId);
    else if (index === 0) this.turn(kingdomId);
  }

  /** The head may land only after its ritual has been on view for the minimum time. */
  ready(kingdomId: KingdomId, attemptId: string): boolean {
    const head = this.lines.get(kingdomId)?.[0];
    if (!head || head.attemptId !== attemptId || this.revealing.has(kingdomId)) return false;
    if (head.shownAt === undefined) { this.show(head); return false; }
    return this.now() - head.shownAt >= (this.options.minimumMs ?? FORGE_RITUAL_MIN_MS);
  }

  line(kingdomId: KingdomId): readonly (ForgeLineEntry & { readonly shownAt?: number })[] {
    return (this.lines.get(kingdomId) ?? []).map(entry => ({ ...entry }));
  }

  clear(): void {
    for (const { timer } of this.revealing.values()) clearTimeout(timer);
    this.revealing.clear(); this.lines.clear();
  }

  private reveal(kingdomId: KingdomId): void {
    const ms = this.options.revealMs ?? FORGE_REVEAL_MS;
    if (ms <= 0) return;
    clearTimeout(this.revealing.get(kingdomId)?.timer);
    const timer = setTimeout(() => { this.revealing.delete(kingdomId); this.turn(kingdomId); }, ms);
    timer.unref?.();
    this.revealing.set(kingdomId, { until: this.now() + ms, timer });
  }

  private turn(kingdomId: KingdomId): void {
    if (this.revealing.has(kingdomId)) return;
    const head = this.lines.get(kingdomId)?.[0];
    if (head) this.show(head);
  }

  private show(entry: Entry): void {
    entry.shownAt ??= this.now();
    this.emit(entry.kingdomId, { type: 'stage', activityId: entry.attemptId, stage: entry.stage ?? 'judging-words' });
  }

  private emit(kingdomId: KingdomId, event: ForgeTransientActivity): void {
    try { this.options.publish(kingdomId, event); } catch { /* the room may be closed; the line itself is unchanged */ }
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
}
