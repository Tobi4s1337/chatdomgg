import type { PlayContext } from './slots';
import type { PlaySettingsStore } from './settings';

/**
 * What the walk gives the play HUD and the ledger. The walk owns the pointer lock, the keyboard and the camera;
 * the HUD only draws them and asks for changes. One host per walking session.
 */

/**
 * The mouse, as the person experiences it.
 * - `idle`: not captured; one click into the world captures it ("click to walk").
 * - `requesting`: a click asked the browser and the answer has not arrived.
 * - `locked`: captured; the world turns with the hand.
 * - `cooldown`: the browser refused a capture right after one was let go (Chrome waits about a second). Calm, not
 *   an error: the next click tries again.
 * - `leased`: a panel (the ledger, the Forge, the builder, a place) holds the cursor.
 * - `touch`: a phone or tablet: the stick and touch orbit, no capture at all.
 * - `unavailable`: this browser or frame cannot capture the mouse (a sandboxed embed); the HUD says so once.
 */
export type CursorState = 'idle' | 'requesting' | 'locked' | 'cooldown' | 'leased' | 'touch' | 'unavailable';

export interface CursorView {
  readonly state: CursorState;
  /** The page is fullscreen (ours or the browser's own). */
  readonly fullscreen: boolean;
  /** Keyboard lock is active: Escape, Ctrl+W and other shortcuts reach the game, not the browser. */
  readonly keyboardLocked: boolean;
  /** This browser can enter fullscreen from the page. */
  readonly canFullscreen: boolean;
  /** This browser can lock the keyboard in fullscreen (Chromium on desktop). */
  readonly canLockKeyboard: boolean;
}

/** The way to your own door, from the founded plan and your real plot. Null when you have no home here. */
export interface WayHome {
  /** The street your door opens onto, as the plan names it, or null when the plan gives it no name. */
  readonly street: string | null;
  /** Straight-line metres from where you stand to your door. */
  readonly metres: number;
  /** Direction to your door relative to where the camera looks, in radians: 0 ahead, positive to the right. */
  readonly relative: number;
  /** True while you are inside your own home. */
  readonly inside: boolean;
}

/** The build rack where the engine really offers building, otherwise one honest line about when it opens. */
export interface PlayBuildEntry {
  readonly open: (() => void) | null;
  readonly note: string;
}

export type PlayCue = 'wood' | 'brass' | 'parchment';

/** A fader of the ledger's Sound section. */
export type PlayVolume = 'master' | 'world' | 'voice' | 'interface';

export interface PlayHost {
  readonly ctx: PlayContext;
  readonly settings: PlaySettingsStore;
  readonly cursor: CursorView;
  onCursor(listener: (cursor: CursorView) => void): () => void;
  /**
   * Back to the street from a trusted click or tap: closes the ledger and captures the mouse in the same gesture.
   * Escape cannot capture (browsers never let it), so Escape only closes and leaves the calm click-to-walk state.
   */
  resume(event: { readonly isTrusted: boolean }): void;
  /** Enter or leave fullscreen (with keyboard lock where the browser offers it). Must be called from a gesture. */
  toggleFullscreen(): void;
  /** Live: read it each time the page draws. */
  wayHome(): WayHome | null;
  readonly build: PlayBuildEntry;
  /**
   * The faders the kingdom's sound really applies, in the ledger's order. Empty: the Sound section is not shown
   * (a fader that changes nothing is a dead control). The settings keep every volume either way.
   */
  readonly volumes: readonly PlayVolume[];
  /** A UI sound in the kit's materials: wood (shutter, tabs), brass (toggles, sliders), parchment (pages). */
  cue(surface: PlayCue): void;
  /** The world prompt to show now ("Take a rod"), with the use key's words; null when none. */
  readonly prompt: { readonly id: string; readonly label: string } | null;
  onPrompt(listener: (prompt: { readonly id: string; readonly label: string } | null) => void): () => void;
  /** A touch on the prompt: the same as the use key. */
  usePrompt(): void;
}

/** What the HUD gives back to the walk. */
export interface PlayHud {
  openLedger(page?: string): void;
  closeLedger(): void;
  readonly ledgerOpen: boolean;
  onLedger(listener: (open: boolean) => void): () => void;
  /** Escape while the ledger or a panel inside it is open: closes the top layer. True when handled. */
  escape(): boolean;
  dispose(): void;
}
