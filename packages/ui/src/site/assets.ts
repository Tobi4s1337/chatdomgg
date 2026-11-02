// The kit's own files, resolved by whichever build imports the kit: the official Twitch Glitch and the four How it
// works pictures (real captures of the Atlas and of Willowmere).
import glitch from './twitch/glitch_flat_purple.svg';
import read400 from './img/hiw-read-400.webp';
import read640 from './img/hiw-read-640.webp';
import continents400 from './img/hiw-continents-400.webp';
import continents640 from './img/hiw-continents-640.webp';
import glow400 from './img/hiw-glow-400.webp';
import glow640 from './img/hiw-glow-640.webp';
import door400 from './img/hiw-door-400.webp';
import door640 from './img/hiw-door-640.webp';
import type { HowItWorksKey } from './pieces.mjs';

/** The official Twitch Purple Glitch, byte for byte as Twitch's brand kit ships it (see `twitch-brand.md`). */
export const GLITCH_URL: string = glitch;

const PICTURES: Readonly<Record<HowItWorksKey, Readonly<Record<400 | 640, string>>>> = {
  read: { 400: read400, 640: read640 },
  continents: { 400: continents400, 640: continents640 },
  glow: { 400: glow400, 640: glow640 },
  door: { 400: door400, 640: door640 },
};
export const howItWorksPicture = (key: HowItWorksKey, width: 400 | 640): string => PICTURES[key][width];
