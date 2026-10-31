import type { CameraState } from '../map/motion';

/** The slice of `window.history` the card history needs (and tests can stand in for). */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  replaceState(data: unknown, unused: string): void;
  back(): void;
}

interface CardEntry { chatdomAtlas: 'card'; id: string; view: CameraState }

const isCardEntry = (state: unknown): state is CardEntry =>
  typeof state === 'object' && state !== null && (state as { chatdomAtlas?: unknown }).chatdomAtlas === 'card';

/**
 * Back means "the view before this card" (Spec 01 R9). Opening a card pushes one history entry that remembers the
 * camera from before the map moved to show it; choosing another holding replaces that entry and keeps the original
 * view. Back closes the card and returns the camera there. Closing the card any other way (its button, Escape, a tap
 * on bare paper) steps back over its entry quietly, so the next Back leaves the map as the reader expects.
 *
 * The URL does not change here; channel routes (`/map/<login>`) build on this entry when they arrive.
 */
export class CardHistory {
  private open: CardEntry | null = null;
  private quiet = 0;

  constructor(private readonly history: HistoryLike, private readonly onBack: (view: CameraState) => void) {}

  get isOpen(): boolean {
    return this.open !== null;
  }

  opened(id: string, view: CameraState): void {
    if (this.open && isCardEntry(this.history.state)) {
      this.open = { ...this.open, id };
      this.history.replaceState(this.open, '');
      return;
    }
    this.open = { chatdomAtlas: 'card', id, view };
    this.history.pushState(this.open, '');
  }

  /**
   * Call once the page listens for `popstate`. A reload on a card's entry finds no card open (its view and selection
   * went with the page), so step back over that entry quietly: otherwise the reader's first Back would do nothing.
   */
  resume(): void {
    if (this.open || !isCardEntry(this.history.state)) return;
    this.quiet++;
    this.history.back();
  }

  /** The card was closed on the page (not by Back). */
  closed(): void {
    if (!this.open) return;
    this.open = null;
    if (isCardEntry(this.history.state)) {
      this.quiet++;
      this.history.back();
    }
  }

  /** Call from `popstate`. Returns true when the event was the card's own and has been handled. */
  popped(): boolean {
    if (this.quiet > 0) {
      this.quiet--;
      return true;
    }
    if (!this.open) return false;
    const view = this.open.view;
    this.open = null;
    this.onBack(view);
    return true;
  }
}
