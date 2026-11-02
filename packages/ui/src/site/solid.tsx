// The kit's public pieces as Solid components, for surfaces that render with Solid (the Atlas, the walk-in gate).
// Each draws the same markup as `@chatdom/ui/site`; import `@chatdom/ui/site.css` (and `kit.css`) beside them.
import { onCleanup, onMount, type JSX } from 'solid-js';
import { GLITCH_URL } from './assets';
import { iconSvg, twitchMark, watchOnTwitch, type FooterOptions, type HowItWorksOptions, type IconName, type PieceSize } from './pieces.mjs';
import { createHowItWorks, createSiteFooter, mountSignInSeal, type SealOptions } from './seal';
import type { Session } from './session';

/** The sign-in seal: signed out at once, then the real session. Pass `view` to keep an exact view across sign-in. */
export function SignInSeal(props: SealOptions & { class?: string }): JSX.Element {
  let host: HTMLSpanElement | undefined;
  onMount(() => {
    if (!host) return;
    const handle = mountSignInSeal(host, props);
    onCleanup(() => handle.destroy());
  });
  return <span class={`cd-piece${props.class ? ` ${props.class}` : ''}`} ref={el => { host = el; }} />;
}

/** The official Twitch mark in its brass frame. With `label` it is an image of that name; otherwise decorative. */
export function TwitchMark(props: { label?: string }): JSX.Element {
  return <span class="cd-piece" innerHTML={twitchMark({ glitch: GLITCH_URL, ...(props.label ? { label: props.label } : {}) })} />;
}

/** "Watch on Twitch" for one channel, opening twitch.tv in a new tab. */
export function WatchOnTwitch(props: { login: string; words?: string; size?: PieceSize }): JSX.Element {
  return <span class="cd-piece" innerHTML={watchOnTwitch({ login: props.login, glitch: GLITCH_URL,
    ...(props.words ? { words: props.words } : {}), ...(props.size ? { size: props.size } : {}) })} />;
}

/** The site footer with the legal links and the Twitch line (see `FooterOptions` for surfaces away from chatdom.io). */
export function SiteFooter(props: FooterOptions & { session?: Session }): JSX.Element {
  let host: HTMLDivElement | undefined;
  onMount(() => host?.append(createSiteFooter(props)));
  return <div class="cd-piece" ref={el => { host = el; }} />;
}

/** The How it works sheet: four pictures, what we never collect, and the privacy policy. */
export function HowItWorksSheet(props: Omit<HowItWorksOptions, 'img'>): JSX.Element {
  let host: HTMLDivElement | undefined;
  onMount(() => host?.append(createHowItWorks(props)));
  return <div class="cd-piece" ref={el => { host = el; }} />;
}

/** One icon of the kit's family, in the text's own colour. */
export function Icon(props: { name: IconName; class?: string }): JSX.Element {
  return <span class="cd-piece" innerHTML={iconSvg(props.name, props.class ? { class: props.class } : {})} />;
}
