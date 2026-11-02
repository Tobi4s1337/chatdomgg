export interface CatchTag {
  readonly name: string;
  /** One authored line of lore. */
  readonly lore: string;
  /** Already formatted: '412 g'. */
  readonly weight: string;
  /** Already formatted: '31 cm'. */
  readonly length: string;
  readonly rarity: 'common' | 'uncommon' | 'rare';
  /** Stamps the Almanac seal: 'New in your Almanac'. */
  readonly personalFirst: boolean;
  /** Presses a red wax seal: 'First in <kingdomName>'. */
  readonly kingdomFirst: boolean;
  /** The fish's real render. The tag shows without it when null or rejected. */
  readonly portrait: Promise<CanvasImageSource | null> | null;
}

export interface WorldTag { readonly id: string; readonly x: number; readonly y: number; readonly text: string; readonly first: boolean; readonly visible: boolean }

export interface FishingPrompt { readonly label: string; readonly key?: string | undefined; readonly urgent?: boolean | undefined }
export interface FishingFight { readonly tension: number; readonly progress: number; readonly phase: 'rest' | 'warning' | 'run'; readonly tired: boolean }
export type FishingBeat = 'tag' | 'seal' | 'dismiss';

export interface FishingUi {
  /** A small contextual hint near the bottom centre. `key` is shown in a little brass keycap. null hides. */
  prompt(value: FishingPrompt | null): void;
  /** The fight read while a fish is on. Safe to call every frame: it formats nothing and writes only what changed. null hides. */
  fight(value: FishingFight | null): void;
  /** A brief line in plain words. Fades on its own; a new note replaces the old one. */
  note(message: string, tone?: 'plain' | 'warn'): void;
  /** Your own catch: the paper tag slides in, holds about 5 s (or until clicked, tapped or Escape), and slides out. */
  caught(tag: CatchTag): void;
  /** Labels over the pier for other people's catches, in CSS px of the host. Safe to call every frame. */
  worldTags(tags: readonly WorldTag[]): void;
  dispose(): void;
}

export interface FishingUiOptions {
  readonly compact: boolean;
  readonly kingdomName: string;
  /** 'tag' as the tag starts to slide in, 'seal' at each stamp's impact, 'dismiss' as it starts to slide out. */
  readonly onBeat?: ((beat: FishingBeat) => void) | undefined;
}
