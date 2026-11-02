// Types for pieces.mjs (plain JavaScript so a build script can read it without a compiler).

export type IconName = 'door' | 'atlas' | 'card' | 'panel' | 'home' | 'search' | 'watch' | 'chat' | 'live' | 'crown'
  | 'sign-out' | 'external' | 'arrow-right' | 'arrow-down' | 'close';
export type PieceSize = 'small' | 'header' | 'large';
export type HowItWorksKey = 'read' | 'continents' | 'glow' | 'door';

export declare function escapeHtml(text: string): string;
export declare const ICON_PATHS: Readonly<Record<IconName, string>>;
export declare function iconSvg(name: IconName, options?: { class?: string }): string;
export declare function brandCrest(): string;
export declare function brandLink(options?: { base?: string; class?: string; current?: string }): string;
export declare function twitchMark(options: { glitch: string; label?: string }): string;
export declare function twitchButton(options: { href: string; words: string; glitch: string; size?: PieceSize | undefined; class?: string; attrs?: string; external?: boolean }): string;
export declare function watchOnTwitch(options: { login: string; glitch: string; words?: string; size?: PieceSize }): string;
export declare function signInSeal(options: { href: string; glitch: string; size?: PieceSize | undefined }): string;

export interface FooterLink { readonly page: string; readonly path: string; readonly words: string; readonly de?: string }
export declare const FOOTER_LINKS: readonly FooterLink[];
export declare const TWITCH_LINE: string;
export declare const TRADEMARK_LINE: string;
export declare const OPERATOR_LINE: string;
export interface FooterOptions {
  /** The page you are on (`imprint`, `privacy`, `terms`, `how-it-works`, `map`, `index`). */
  current?: string | undefined;
  /** An origin for absolute links, for surfaces away from chatdom.io (`https://chatdom.io`). */
  base?: string;
  /** Open the links in a new tab. */
  external?: boolean;
  /** `false` leaves out the Twitch line and trademark note (the Twitch panel extension). */
  twitch?: boolean;
  /** A tighter footer for narrow surfaces such as the panel. */
  compact?: boolean;
  links?: readonly FooterLink[];
}
export declare function siteFooter(options?: FooterOptions): string;

export interface HowItWorksPanel { readonly step: string; readonly key: HowItWorksKey; readonly title: string; readonly words: string; readonly alt: string }
export declare const HOW_IT_WORKS: readonly HowItWorksPanel[];
export declare const NEVER_COLLECTED: readonly (readonly [string, string])[];
export interface HowItWorksOptions {
  img: (key: HowItWorksKey, width: 400 | 640) => string;
  heading?: 2 | 3 | 4;
  title?: string;
  id?: string;
  sizes?: string;
  base?: string;
  external?: boolean;
}
export declare function howItWorksSheet(options: HowItWorksOptions): string;
export declare function noticeSlip(): string;
