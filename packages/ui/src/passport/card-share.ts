import { SHIELD } from './crest';
import { isoDay, longDate, monthSpan } from './format';
import { contrast, inkHash, inkStream, parseHex } from './ink';
import { armsSvg, chargeMarkup, escapeMarkup, stampSvg } from './markup';
import { curateShareSpread } from './share';
import type { CrestView, StampView, VisiblePassportView } from './types';

/**
 * The citizen card's share picture: one 1200 × 630 composition (the Open Graph size) of the card lying on a lamp-lit
 * walnut desk with the citizen's passport beside it. The card is the same plaque the kingdom shows (their painted
 * portrait in an arched brass window, their name in their chat colour, standing, kingdom, home, tenure and the earned
 * pieces they wear); the passport is the same book, drawn from the same stamp markup and ink.
 *
 * The passport obeys its disclosure exactly. A visible book lies open on its newest journeys in the authority's order
 * (never a total or a count); a visible but empty book lies closed with the holder's name on its cover and nothing
 * pressed into it; hidden travels draw no book at all, and the card is recomposed alone. A hidden passport carries no
 * data into this module, so nothing travel-derived can reach the picture, its title or its words.
 *
 * Pure strings, no DOM, no script and no fetch: the server renders it to PNG with the same closed policy as the
 * passport's own share image. The portrait arrives as bytes (a `data:image/png` or `data:image/webp` URL); anything
 * else is refused and the kingdom's painted arms hang in the window instead, never a stand-in face.
 */
export const CITIZEN_SHARE_SIZE = { width: 1200, height: 630 } as const;
/** Journeys on the open page: the newest two, large enough to read their ink in a link preview. */
export const CITIZEN_SHARE_STAMPS = 2;
/** Earned pieces named on the card; the card itself lists every one. */
export const CITIZEN_SHARE_WORN = 3;
/** Tenure facts written on the card. */
export const CITIZEN_SHARE_FACTS = 3;

/** A tenure fact, already worded by the caller. A null value has not been witnessed and reads "Not known yet". */
export interface CitizenShareFact {
  readonly label: string;
  readonly value: string | null;
  /** The engraved mark beside it: a lantern for following, a pennant for a subscription. */
  readonly mark?: 'follow' | 'subscribed';
}

export interface CitizenShareHome {
  readonly name: string;
  readonly street: string;
  /** The home's tier in words, e.g. "A cottage". */
  readonly tier: string;
}

export interface CitizenSharePortrait {
  /** Only `data:image/png;base64,…` or `data:image/webp;base64,…`: the picture fetches nothing. */
  readonly src: string;
  readonly alt: string;
}

export interface CitizenShareWorn { readonly name: string; readonly story: string | null }

export type CitizenSharePassport = { readonly hidden: true } | { readonly hidden: false; readonly book: VisiblePassportView };

/** Everything the picture may show, all of it public on the card already. */
export interface CitizenShareCard {
  readonly origin: 'live' | 'simulated';
  readonly name: string;
  readonly login: string | null;
  /** Their Twitch chat colour as `#rrggbb`, or null. A colour that would not read on parchment is shown as a swatch. */
  readonly colour: string | null;
  /** Their standing in words, in order, e.g. `['Knight of the Watch', 'Citizen No. 212']`. */
  readonly standing: readonly string[];
  readonly kingdom: { readonly name: string; readonly crest: CrestView };
  readonly home: CitizenShareHome | null;
  readonly tenure: readonly CitizenShareFact[];
  readonly portrait: CitizenSharePortrait | null;
  readonly worn: readonly CitizenShareWorn[];
  readonly passport: CitizenSharePassport;
}

export interface CitizenShareOptions {
  /** `@font-face` rules for IM Fell English, IM Fell English SC and Alegreya; the renderer embeds the bytes. */
  readonly fontFaces?: string;
  /** The site mark printed on the desk. */
  readonly site?: string;
}

export interface CitizenShare {
  /** A complete HTML document sized exactly `CITIZEN_SHARE_SIZE`, with no script and no external resource. */
  readonly html: string;
  /** For `og:title` and the image's own title. */
  readonly title: string;
  /** Everything the image shows, in words, for `og:image:alt` and `alt`. */
  readonly alt: string;
  readonly width: 1200;
  readonly height: 630;
}

/* ---------- Rules ---------- */

const PORTRAIT_SOURCE = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A portrait the picture may draw: inline PNG or WebP bytes and nothing else. */
export function acceptedPortrait(portrait: CitizenSharePortrait | null): CitizenSharePortrait | null {
  return portrait && PORTRAIT_SOURCE.test(portrait.src) ? portrait : null;
}

/** The darkest the card's parchment gets where the name is written; a name colour is judged against it. */
const NAME_PAPER = parseHex('#e6d3a9');
const INK = '#2c2118';
const READABLE = 3.4;

/** Their chat colour when it reads on parchment; otherwise ink, with their colour kept as a swatch beside the name. */
export function nameInk(colour: string | null): { readonly ink: string; readonly swatch: string | null } {
  if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) return { ink: INK, swatch: null };
  return contrast(parseHex(colour), NAME_PAPER) >= READABLE ? { ink: colour.toLowerCase(), swatch: null } : { ink: INK, swatch: colour.toLowerCase() };
}

type Book = { readonly kind: 'open'; readonly book: VisiblePassportView; readonly stamps: readonly StampView[]; readonly more: boolean }
  | { readonly kind: 'closed'; readonly book: VisiblePassportView }
  | { readonly kind: 'none' };

/** What of the passport the picture shows, chosen by the book's own share rules and nothing else. */
function bookOf(passport: CitizenSharePassport): Book {
  if (passport.hidden) return { kind: 'none' };
  const spread = curateShareSpread(passport.book);
  if (spread.stamps.length === 0) return { kind: 'closed', book: passport.book };
  return { kind: 'open', book: passport.book, stamps: spread.stamps.slice(0, CITIZEN_SHARE_STAMPS), more: spread.moreStamps || spread.stamps.length > CITIZEN_SHARE_STAMPS };
}

const journeyWords = (stamp: StampView) => stamp.kind === 'raid'
  ? `a raid on ${stamp.kingdom.name}${stamp.leader ? ` led by ${stamp.leader.name}` : ''}, ${longDate(stamp.at)}`
  : `a visit to ${stamp.kingdom.name}, ${longDate(stamp.at)}`;

const sentence = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;

/** The image in words. A hidden passport is not mentioned at all: its absence says nothing about the travels. */
export function citizenShareAlt(card: CitizenShareCard): string {
  const parts: string[] = [];
  const standing = card.standing.length ? `, ${card.standing.join(', ')}` : '';
  parts.push(`The citizen card of ${card.name}${standing}, of ${card.kingdom.name}.`);
  const portrait = acceptedPortrait(card.portrait);
  parts.push(portrait ? `Their painted portrait: ${sentence(portrait.alt)}` : `The arms of ${card.kingdom.name} hang where a portrait would be.`);
  parts.push(card.home ? `Home: ${card.home.name}, ${card.home.street} (${card.home.tier.replace(/^A /, 'a ')}).` : `Not settled in ${card.kingdom.name} yet.`);
  for (const fact of card.tenure.slice(0, CITIZEN_SHARE_FACTS)) parts.push(`${fact.label}: ${fact.value ?? 'not known yet'}.`);
  const worn = card.worn.slice(0, CITIZEN_SHARE_WORN);
  if (worn.length) parts.push(`Earned and worn: ${worn.map(piece => piece.story ? `${piece.name} (${piece.story})` : piece.name).join('; ')}.`);
  const book = bookOf(card.passport);
  if (book.kind === 'open') {
    parts.push(`Beside it their passport lies open on its latest journeys: ${book.stamps.map(journeyWords).join('; ')}.`
      + (book.more ? ' Older journeys are further back in the book.' : ''));
  } else if (book.kind === 'closed') {
    parts.push(`Beside it lies their passport, closed, with ${book.book.holder.name} on its cover and no journeys in it yet.`);
  }
  if (simulatedOf(card)) parts.push('SIMULATED: an illustrative citizen, not a live one.');
  return parts.join(' ');
}

const simulatedOf = (card: CitizenShareCard) => card.origin === 'simulated' || (!card.passport.hidden && card.passport.book.origin === 'simulated');

/* ---------- Markup ---------- */

const lengthOf = (text: string, short: number, long: number) => {
  const length = [...text].length;
  return length > long ? 'long' : length > short ? 'mid' : 'short';
};
const bdi = (text: string) => `<bdi dir="auto">${escapeMarkup(text)}</bdi>`;
const time = (ms: number) => `<time datetime="${isoDay(ms)}">${escapeMarkup(longDate(ms))}</time>`;

/** The card's engraved marks, the same nib and paths as the plaque's own. */
const MARKS = {
  follow: 'M12 2.8v2.4M9 5.2h6M8.2 8.4c0-1.8 1.7-3.2 3.8-3.2s3.8 1.4 3.8 3.2v7.2c0 1.6-1.7 2.9-3.8 2.9s-3.8-1.3-3.8-2.9zM8.2 9.4h7.6M8.2 14.6h7.6M12 11.2c-.9 1-.9 2 0 2.6.9-.6.9-1.6 0-2.6zM10 18.4l-.6 2.6h5.2l-.6-2.6',
  subscribed: 'M6.5 3v18M6.5 4.2h11.2l-3 3.9 3 3.9H6.5M9.4 7.2l1 .9-1 .9',
  home: 'M3.6 11.4 12 4.4l8.4 7M5.8 9.6V20h12.4V9.6M10.2 20v-4.6a1.8 1.8 0 0 1 3.6 0V20M16.4 6.2V4.2h1.8v3.5',
  /** A rosette on two ribbon tails: a piece earned, not bought. */
  earned: 'M12 3.2a5.4 5.4 0 1 1 0 10.8a5.4 5.4 0 1 1 0-10.8zM12 5.8l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3zM9 13.2 7.4 20.6l2.6-1.4 1.2 2.4 1-7.4M15 13.2l1.6 7.4-2.6-1.4-1.2 2.4-1-7.4',
} as const;
const mark = (name: keyof typeof MARKS, cls = 'mk') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${MARKS[name]}"/></svg>`;

const corner = (where: 'tl' | 'tr' | 'bl' | 'br') => `<svg class="corner ${where}" viewBox="0 0 64 64" aria-hidden="true">`
  + `<path d="M2 2h50c2 0 3 1.2 2.4 3.1L50 14c-.8 2-2.4 2.8-4.6 2.8H22c-3 0-5.2 2.2-5.2 5.2v23.4c0 2.2-.8 3.8-2.8 4.6L5.1 54.4C3.2 55 2 54 2 52z" fill="url(#brass)" stroke="#3d2a0e" stroke-width="1.4"/>`
  + '<path d="M5.5 5.5h44.6M5.5 5.5v44.6" stroke="#fff3c6" stroke-opacity=".55" stroke-width="1.2" fill="none"/>'
  + '<path d="M9 9.5h33M9.5 9v33" stroke="#5a3d12" stroke-opacity=".5" stroke-width=".9" fill="none" stroke-dasharray="1.6 2.4"/>'
  + '<circle cx="11" cy="11" r="3.3" fill="url(#rivet)" stroke="#3d2a0e" stroke-width=".8"/><circle cx="36" cy="10" r="2.4" fill="url(#rivet)" stroke="#3d2a0e" stroke-width=".7"/>'
  + '<circle cx="10" cy="36" r="2.4" fill="url(#rivet)" stroke="#3d2a0e" stroke-width=".7"/></svg>';

/** Gradients the brass corners share, defined once in the document. */
const BRASS_DEFS = '<svg class="defs" width="0" height="0" aria-hidden="true"><defs>'
  + '<linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dd97"/><stop offset=".28" stop-color="#cf9f48"/><stop offset=".62" stop-color="#9a6c26"/><stop offset="1" stop-color="#5e3f14"/></linearGradient>'
  + '<radialGradient id="rivet" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff0be"/><stop offset=".45" stop-color="#c8963e"/><stop offset="1" stop-color="#4f3410"/></radialGradient>'
  + '</defs></svg>';

const flourish = '<svg class="flourish" viewBox="0 0 240 18" aria-hidden="true" preserveAspectRatio="xMinYMid meet"><path d="M2 9h86c8 0 10-6 16-6s7 5 3 6.6c-3 1.2-6-1.2-3.8-3.4M238 9h-86c-8 0-10 6-16 6s-7-5-3-6.6c3-1.2 6 1.2 3.8 3.4M112 9c2.6-3.6 5.4-5.4 8-5.4s5.4 1.8 8 5.4c-2.6 3.6-5.4 5.4-8 5.4s-5.4-1.8-8-5.4z"/></svg>';

/** The kingdom's seal on the card, poured from the arms' strongest tincture and pressed with the arms' own outline and charge. */
function cardSeal(crest: CrestView, size: number): string {
  // The card's seal is always the plaque's red sealing wax, as on the card itself; the kingdom is in its impression.
  const inks = { wax: '#9b2a22', waxHi: '#c4473a', waxLo: '#6a1914' };
  const next = inkStream(inkHash(`card-seal:${crest.key}`));
  const phase = [next() * 6.28, next() * 6.28, next() * 6.28] as const;
  const points: string[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const r = 44 * (1 + Math.sin(t * 3 + phase[0]) * 0.045 + Math.sin(t * 5 + phase[1]) * 0.03 + Math.sin(t * 9 + phase[2]) * 0.02);
    points.push(`${(50 + Math.cos(t) * r).toFixed(2)} ${(50 + Math.sin(t) * r).toFixed(2)}`);
  }
  const outline = `M${points.join('L')}Z`;
  const relief = ([[-1.2, -1.3, inks.waxHi, 0.75], [1.3, 1.5, inks.waxLo, 0.9], [0, 0, inks.wax, 1]] as const).map(([dx, dy, colour, opacity]) =>
    `<g transform="translate(${dx} ${dy})" opacity="${opacity}"><path d="${SHIELD[crest.shape]}" fill="none" stroke="${colour}" stroke-width="5" stroke-linejoin="round"/>`
    + `${chargeMarkup(crest, colour)}</g>`).join('');
  return `<svg class="seal" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><defs>`
    + `<radialGradient id="seal-body" cx=".36" cy=".32" r=".78"><stop offset="0" stop-color="${inks.waxHi}"/><stop offset=".48" stop-color="${inks.wax}"/><stop offset="1" stop-color="${inks.waxLo}"/></radialGradient>`
    + `<radialGradient id="seal-sheen" cx=".34" cy=".28" r=".5"><stop offset="0" stop-color="#fff4e6" stop-opacity=".34"/><stop offset="1" stop-color="#fff4e6" stop-opacity="0"/></radialGradient></defs>`
    + `<path d="${outline}" fill="url(#seal-body)"/>`
    + `<circle cx="50" cy="50" r="33" fill="${inks.waxLo}" fill-opacity=".18" stroke="${inks.waxLo}" stroke-width="2.4"/>`
    + `<circle cx="50.8" cy="51" r="33" fill="none" stroke="${inks.waxHi}" stroke-opacity=".55" stroke-width=".9"/>`
    + `<g transform="translate(50 51) scale(.46) translate(-50 -55)">${relief}</g>`
    + `<path d="${outline}" fill="url(#seal-sheen)"/></svg>`;
}

function portraitWindow(card: CitizenShareCard): string {
  const portrait = acceptedPortrait(card.portrait);
  if (portrait) return `<div class="window painted"><img src="${escapeMarkup(portrait.src)}" alt="${escapeMarkup(portrait.alt)}"></div>`;
  return `<div class="window arms">${armsSvg(card.kingdom.crest, { id: 'card-arms', kingdomName: card.kingdom.name, size: 132 })}`
    + `<span>The arms of ${bdi(card.kingdom.name)}</span></div>`;
}

function plaque(card: CitizenShareCard): string {
  const ink = nameInk(card.colour);
  const swatch = ink.swatch ? `<span class="swatch" style="background:${ink.swatch}" aria-hidden="true"></span>` : '';
  const login = card.login && card.login.toLowerCase() !== card.name.toLowerCase() ? `<p class="login">@${bdi(card.login)}</p>` : '';
  const standing = card.standing.length
    ? `<p class="standing">${card.standing.map(words => `<span>${bdi(words)}</span>`).join('<i aria-hidden="true"></i>')}</p>`
    : '';
  const facts = card.tenure.slice(0, CITIZEN_SHARE_FACTS).map(fact => `<li class="fact">${mark(fact.mark ?? 'follow', fact.mark ? 'mk' : 'mk blank')}`
    + `<span class="label">${escapeMarkup(fact.label)}</span>`
    + (fact.value === null ? '<strong class="value unknown">Not known yet</strong>' : `<strong class="value">${bdi(fact.value)}</strong>`)
    + '</li>').join('');
  const home = card.home
    ? `<li class="fact home" data-length="${lengthOf(`${card.home.name}, ${card.home.street}`, 26, 44)}">${mark('home')}<span class="label">Home</span><strong class="value">${bdi(card.home.name)}<span class="street">, ${bdi(card.home.street)}</span></strong>`
      + `<span class="note">${bdi(card.home.tier)}</span></li>`
    : `<li class="fact home">${mark('home')}<span class="label">Home</span><strong class="value unknown">Not settled in ${bdi(card.kingdom.name)} yet</strong></li>`;
  const worn = card.worn.slice(0, CITIZEN_SHARE_WORN);
  const pieces = worn.length
    ? `<div class="worn"><p class="label">Earned and worn</p><ul>${worn.map(piece => `<li>${mark('earned', 'mk earned')}<span>${bdi(piece.name)}</span></li>`).join('')}</ul></div>`
    : '';
  return `<article class="plaque" data-origin="${card.origin}"><div class="wood">${corner('tl')}${corner('tr')}${corner('bl')}${corner('br')}`
    + `<div class="plate"><span>${bdi(card.kingdom.name)}</span></div>`
    + `<div class="sheet"><div class="paper" aria-hidden="true"></div><div class="body">`
    + `<figure class="portrait">${portraitWindow(card)}</figure>`
    + `<div class="who"><h1 class="name" data-length="${lengthOf(card.name, 12, 20)}" style="color:${ink.ink}">${swatch}${bdi(card.name)}</h1>${login}`
    + `<p class="realm">of ${bdi(card.kingdom.name)}</p>${standing}${flourish}</div>`
    + `<ul class="facts">${facts}${home}</ul>${pieces}`
    + `<div class="seal-slot">${cardSeal(card.kingdom.crest, 92)}</div>`
    + '</div></div></div></article>';
}

/** The compass rose with a road across it, the same one tooled into the passport's cover. */
const compass = (cls: string) => `<svg class="${cls}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke-width="1.6"/>`
  + '<circle cx="60" cy="60" r="43" fill="none" stroke-width=".8" stroke-dasharray="2 3.4"/><path d="M60 14v92M14 60h92" stroke-width=".8"/>'
  + '<path d="M60 22l7 31 31 7-31 7-7 31-7-31-31-7 31-7Z" stroke-width="1.2"/><path d="M60 37l3 20 20 3-20 3-3 20-3-20-20-3 20-3Z" stroke-width=".8"/>'
  + '<path d="M30 96c10-12 22-6 30-18s20-8 30-22" fill="none" stroke-width="1.3" stroke-dasharray="5 3.4"/></svg>';

const fleuron = '<svg class="fleuron" viewBox="0 0 80 24" aria-hidden="true"><path d="M4 12h24M52 12h24" stroke-width="1"/>'
  + '<path d="M40 4c-3 4-8 5-12 8 4 3 9 4 12 8 3-4 8-5 12-8-4-3-9-4-12-8Z" stroke-width="1.1"/><circle cx="40" cy="12" r="2"/></svg>';

function entry(stamp: StampView, index: number): string {
  const kind = stamp.kind === 'raid' ? `Raid${stamp.leader ? `, led by ${bdi(stamp.leader.name)}` : ''}` : 'Visited';
  return `<li class="entry" data-kind="${stamp.kind}">${stampSvg(stamp, { id: `card-s${index}`, size: 148, class: 'stamp' })}`
    + `<div class="words"><h2 class="kingdom" data-length="${lengthOf(stamp.kingdom.name, 10, 20)}">${bdi(stamp.kingdom.name)}</h2>`
    + `<p class="kind">${kind}</p><p class="date">${time(stamp.at)}</p></div></li>`;
}

function passport(book: Book): string {
  if (book.kind === 'none') return '';
  if (book.kind === 'closed') {
    const holder = book.book.holder.name;
    return `<div class="cover"><div class="tooling" aria-hidden="true"></div><p class="cover-word">Passport</p>${compass('cover-rose')}`
      + `<p class="cover-label"><span class="cover-of">belonging to</span><span class="cover-name" data-length="${lengthOf(holder, 14, 24)}">${bdi(holder)}</span></p>`
      + '<span class="band" aria-hidden="true"></span></div>';
  }
  return `<div class="book"><div class="case"><div class="spread"><section class="page left" aria-hidden="true">${compass('rose')}</section>`
    + `<section class="page right"><p class="running-head">${escapeMarkup(monthSpan(book.stamps.map(stamp => stamp.at)))}</p>`
    + `<ol class="entries">${book.stamps.map(entry).join('')}</ol>`
    + (book.more ? `<p class="further">${fleuron}<span>Older journeys are further back in the book</span></p>` : '')
    + '</section></div><span class="ribbon" aria-hidden="true"></span></div></div>';
}

/** Dust turning in the lamp's light: fixed motes, the same in every picture. */
const MOTES = [[246, 92, 2.2, 0.3], [318, 18, 1.4, 0.45], [902, 22, 1.8, 0.26], [968, 12, 2.6, 0.4], [1170, 180, 1.3, 0.45], [20, 230, 1.6, 0.4],
  [1176, 86, 1.9, 0.36], [420, 26, 1.2, 0.3], [760, 14, 1.6, 0.45], [26, 120, 2.1, 0.36], [640, 22, 1.3, 0.3], [1182, 400, 1.6, 0.3],
  [16, 470, 1.4, 0.32], [560, 610, 1.1, 0.22], [140, 16, 1.8, 0.4]] as const;

export function composeCitizenShare(card: CitizenShareCard, options: CitizenShareOptions = {}): CitizenShare {
  const book = bookOf(card.passport);
  const title = `${card.name} of ${card.kingdom.name}`;
  const alt = citizenShareAlt(card);
  const simulated = simulatedOf(card)
    ? '<p class="sim" role="note"><b>SIMULATED</b><span>an illustrative citizen</span></p>'
    : '';
  const motes = MOTES.map(([x, y, r, o]) => `<i style="left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px;opacity:${o}"></i>`).join('');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    // The picture fetches nothing and runs nothing: fonts, marks and the portrait are inline, and the policy says so.
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`
    + `<meta name="viewport" content="width=${CITIZEN_SHARE_SIZE.width},height=${CITIZEN_SHARE_SIZE.height}">`
    + `<title>${escapeMarkup(title)}</title><style>${options.fontFaces ?? ''}${CARD_SHARE_CSS}</style></head>`
    + `<body><main class="desk" data-book="${book.kind}" role="img" aria-label="${escapeMarkup(alt)}">${BRASS_DEFS}`
    + '<div class="lamp" aria-hidden="true"></div>'
    + passport(book) + plaque(card)
    + `<div class="motes" aria-hidden="true">${motes}</div>`
    + `<p class="mark"><span class="mark-word">Chatdom</span><span class="mark-site">${escapeMarkup(options.site ?? 'chatdom.gg')}</span></p>`
    + `${simulated}</main></body></html>`;
  return { html, title, alt, width: CITIZEN_SHARE_SIZE.width, height: CITIZEN_SHARE_SIZE.height };
}

/* ---------- The stylesheet ---------- */

const WOOD = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='160'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.004 .09' numOctaves='3' seed='12'/%3E%3CfeColorMatrix values='0 0 0 0 .16 0 0 0 0 .08 0 0 0 0 .04 0 0 0 -1.4 .9'/%3E%3C/filter%3E%3Crect width='600' height='160' filter='url(%23w)'/%3E%3C/svg%3E\")";
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='240'%3E%3Cfilter id='g' x='0' y='0' width='1' height='1'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.0035 0.085' numOctaves='4' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.16 0 0 0 0 0.08 0 0 0 0 0.04 2.6 0 0 0 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";
const FIGURE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='300'%3E%3Cfilter id='f' x='0' y='0' width='1' height='1'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.0018 0.03' numOctaves='2' seed='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.95 0 0 0 0 0.66 0 0 0 0 0.38 1.4 0 0 0 -0.5'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E\")";
const FIBRE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280'%3E%3Cfilter id='p' x='0' y='0' width='1' height='1'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75 0.55' numOctaves='2' seed='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.30 0 0 0 0 0.16 0 0 0 1.1 -0.52'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E\")";
const MOTTLE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='520' height='520'%3E%3Cfilter id='m' x='0' y='0' width='1' height='1'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.008' numOctaves='3' seed='9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.55 0 0 0 0 0.40 0 0 0 0 0.20 0 0 0 0.9 -0.36'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23m)'/%3E%3C/svg%3E\")";
const LEATHER = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.85' numOctaves='3' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .1 0 0 0 0 .04 0 0 0 0 .02 0 0 0 -1.6 1.15'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E\")";
const PAGE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.018' numOctaves='3' seed='9'/%3E%3CfeColorMatrix values='0 0 0 0 .55 0 0 0 0 .38 0 0 0 0 .18 0 0 0 -.9 .55'/%3E%3C/filter%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.7' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 .4 0 0 0 0 .28 0 0 0 0 .14 0 0 0 -1.2 .62'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23m)' opacity='.5'/%3E%3Crect width='260' height='260' filter='url(%23f)' opacity='.35'/%3E%3C/svg%3E\")";
const DECKLE = {
  top: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='9' viewBox='0 0 160 9'%3E%3Cpath d='M0 9 L0.0 2.1 L4.0 3.4 L6.7 1.2 L10.3 2.0 L14.7 4.2 L19.7 1.7 L25.7 3.1 L30.9 1.4 L35.7 4.5 L41.7 2.9 L47.7 3.8 L51.8 4.1 L58.0 6.6 L61.1 2.0 L65.3 3.5 L69.9 2.6 L74.7 3.3 L79.9 4.5 L86.4 3.6 L92.3 4.7 L97.1 3.8 L102.9 3.3 L105.7 4.3 L108.5 4.1 L111.6 2.3 L117.6 1.4 L120.3 3.8 L126.3 4.7 L132.8 4.5 L137.7 1.3 L141.9 3.4 L144.5 4.3 L150.9 4.4 L155.2 3.1 L160.0 2.1 L160 9Z'/%3E%3C/svg%3E\")",
  bottom: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='9' viewBox='0 0 160 9'%3E%3Cpath d='M0 0 L0.0 5.6 L5.7 4.4 L11.9 7.7 L18.1 5.5 L21.1 6.1 L25.8 3.5 L29.1 6.8 L34.7 7.2 L37.8 5.6 L40.3 4.7 L43.6 4.3 L47.3 4.3 L52.5 7.1 L57.8 4.3 L61.5 6.5 L64.5 7.6 L69.4 7.8 L73.3 6.7 L77.7 6.7 L83.0 7.6 L85.6 5.1 L88.2 5.0 L93.0 5.6 L96.2 4.4 L101.8 4.5 L105.6 6.5 L111.2 7.4 L116.9 2.5 L123.2 7.5 L128.2 4.5 L134.4 5.8 L138.1 5.0 L141.2 5.3 L144.4 7.6 L149.0 6.3 L153.9 4.8 L158.1 7.6 L160.0 5.6 L160 0Z'/%3E%3C/svg%3E\")",
  left: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='160' viewBox='0 0 9 160'%3E%3Cpath d='M9 0 L2.4 0.0 L1.5 5.1 L1.4 9.1 L5.0 11.7 L2.7 14.6 L2.0 17.6 L3.3 23.9 L1.4 30.3 L3.9 33.9 L4.1 37.7 L3.5 42.5 L3.6 47.2 L3.6 50.5 L3.3 54.3 L4.1 58.0 L3.3 61.4 L3.8 67.4 L1.6 73.9 L1.7 79.4 L3.6 82.0 L4.4 86.8 L3.3 92.1 L4.2 96.4 L5.8 100.8 L3.5 106.1 L2.2 111.9 L1.3 117.1 L3.8 120.3 L1.7 125.9 L6.5 129.9 L3.2 134.2 L4.3 140.0 L2.5 144.1 L1.7 150.5 L2.0 153.9 L4.3 158.8 L2.4 160.0 L9 160Z'/%3E%3C/svg%3E\")",
  right: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='160' viewBox='0 0 9 160'%3E%3Cpath d='M0 0 L6.2 0.0 L6.1 6.2 L7.1 11.0 L2.7 16.1 L7.5 19.8 L7.6 25.1 L5.4 31.4 L7.7 34.5 L7.1 37.3 L6.1 39.9 L5.9 45.8 L5.4 50.3 L4.2 53.9 L5.3 59.7 L4.6 63.2 L6.4 68.7 L4.4 72.8 L7.0 75.3 L4.3 79.7 L5.5 82.4 L7.5 86.0 L2.9 92.4 L5.2 95.9 L7.2 101.6 L7.1 105.8 L3.3 108.9 L7.0 113.1 L4.9 119.4 L7.0 125.5 L3.3 131.4 L7.0 137.9 L6.6 143.4 L7.5 146.2 L5.6 149.7 L4.3 154.0 L4.7 158.8 L6.2 160.0 L0 160Z'/%3E%3C/svg%3E\")",
};
const DECKLE_MASK = `${DECKLE.top} top left/160px 9px repeat-x,${DECKLE.bottom} bottom left/160px 9px repeat-x,`
  + `${DECKLE.left} top left/9px 160px repeat-y,${DECKLE.right} top right/9px 160px repeat-y,linear-gradient(#000,#000) center/calc(100% - 16px) calc(100% - 16px) no-repeat`;

const DISPLAY = "'IM Fell English',Georgia,'Noto Serif','Noto Naskh Arabic','Noto Serif CJK JP',serif";
const CAPS = "'IM Fell English SC','IM Fell English',Georgia,serif";
const TEXT = "Alegreya,Georgia,'Noto Serif','Noto Naskh Arabic','Noto Serif CJK JP',serif";

/* Every text colour on parchment is the card's ink (#2c2118) or soft ink (#5d4a37, >5:1); on the desk it is cream or
   worn gilt. The name, kingdom and portrait are sized to survive the picture shown 320 px wide in a link preview. */
const CARD_SHARE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#140c08}
body{font-family:${TEXT};color:#2c2118;font-synthesis:none;-webkit-font-smoothing:antialiased}
bdi{unicode-bidi:isolate}
.defs{position:absolute}
.desk{position:relative;width:1200px;height:630px;overflow:hidden;
  background:radial-gradient(circle at 30% -14%,#ffb25a4a,#ff8a3a1a 26%,transparent 46%),
  radial-gradient(ellipse 66% 62% at 46% 46%,#7a4e2e 0,#4a2e1c 48%,transparent 80%),
  ${WOOD},
  repeating-linear-gradient(91deg,#ffdcae08 0 3px,transparent 3px 13px,#0a040214 13px 14px,transparent 14px 27px),
  linear-gradient(180deg,#2c1d14,#1c120c 70%,#120b08)}
.desk::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:8;
  background:radial-gradient(ellipse 82% 78% at 46% 46%,transparent 56%,#0a0503a8 100%)}
.lamp{position:absolute;inset:-140px -40px auto;height:560px;pointer-events:none;mix-blend-mode:screen;z-index:7;
  background:radial-gradient(ellipse 40% 52% at 34% 28%,#ffc77a30,#ff9e4a10 52%,transparent 74%)}
.motes{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;z-index:9}
.motes i{position:absolute;border-radius:50%;background:radial-gradient(circle,#fff1d0,#ffd38a80 45%,transparent 70%)}

.plaque{position:absolute;z-index:4;left:30px;top:46px;width:704px;height:548px;transform:rotate(-1.3deg)}
[data-book=none] .plaque{left:150px;top:44px;width:900px;height:550px;transform:rotate(-.7deg)}
.wood{position:relative;display:flex;width:100%;height:100%;padding:34px 20px 20px;border-radius:16px;
  background:linear-gradient(180deg,#ffdcaa29,#ffdcaa00 18%,#0000 80%,#00000038),${GRAIN} 0 0/640px 240px,${FIGURE} 0 0/900px 300px,
  linear-gradient(100deg,#6b4128,#8a5734 38%,#6b4128 62%,#4a2c1a);
  box-shadow:inset 0 2px 0 #ffd6a047,inset 0 -3px 0 #0000004d,inset 0 0 0 1px #1e0e06b3,inset 0 0 24px #14080273,
  0 2px 0 #2a170c,0 22px 34px #0b0402b8,0 5px 10px #0b040299}
.wood::before{content:'';position:absolute;inset:9px;border-radius:10px;box-shadow:inset 0 1px 0 #00000059,inset 0 -1px 0 #ffdcaa2e,0 1px 0 #ffdcaa24}
.corner{position:absolute;z-index:3;width:52px;height:52px;filter:drop-shadow(0 2px 2px #0a040080)}
.corner.tl{top:4px;left:4px}.corner.tr{top:4px;right:4px;transform:scaleX(-1)}
.corner.bl{bottom:4px;left:4px;transform:scaleY(-1)}.corner.br{bottom:4px;right:4px;transform:scale(-1,-1)}
.plate{position:absolute;top:6px;left:50%;z-index:3;transform:translateX(-50%);max-width:calc(100% - 150px);padding:5px 32px 6px;border-radius:4px;
  background:linear-gradient(180deg,#ffffff47,#fff0 45%,#0000001f),repeating-linear-gradient(90deg,#ffffff0d 0 1px,#00000008 1px 3px),
  linear-gradient(90deg,#7a5420,#c99a45 18%,#f7e1a0 50%,#c99a45 82%,#7a5420);
  box-shadow:inset 0 1px 0 #fff8dccc,inset 0 -1px 0 #462c0ab3,0 0 0 1px #3d2a0e,0 3px 5px #0a040080}
.plate::before,.plate::after{content:'';position:absolute;top:50%;width:7px;height:7px;margin-top:-3.5px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#fff1c4,#a77a30 60%,#4a300c);box-shadow:0 0 0 .8px #3d2a0e}
.plate::before{left:11px}.plate::after{right:11px}
.plate span{display:block;white-space:nowrap;overflow:hidden;font:400 18px/1.25 ${CAPS};letter-spacing:.14em;color:#3a2709;
  text-shadow:0 1px 0 #fff4cdbf,0 -1px 0 #3c240659}
.sheet{position:relative;flex:1;min-width:0;display:flex}
.sheet::before{content:'';position:absolute;inset:3px 2px -3px;border-radius:3px;box-shadow:0 4px 10px #1408028c}
.paper{position:absolute;inset:0;
  background:radial-gradient(90% 70% at 18% 8%,#ffc4783d,#ffc87800 60%),radial-gradient(140% 120% at 50% 50%,#0000 55%,#6e481e42 100%),
  ${FIBRE} 0 0/280px 280px,${MOTTLE} 0 0/520px 520px,#efe1bf;
  -webkit-mask:${DECKLE_MASK};mask:${DECKLE_MASK}}
.body{position:relative;flex:1;min-width:0;display:grid;align-items:start;padding:22px 26px 18px;
  align-content:center;grid-template:'portrait who' auto 'portrait worn' auto 'facts facts' auto/256px minmax(0,1fr);column-gap:26px}
[data-book=none] .body{padding:26px 36px 22px;column-gap:38px;
  grid-template:'portrait who' auto 'portrait facts' auto 'portrait worn' 1fr/300px minmax(0,1fr)}
.portrait{grid-area:portrait}.who{grid-area:who}.facts{grid-area:facts}.worn{grid-area:worn}

.portrait{padding:7px;border-radius:128px 128px 12px 12px/118px 118px 12px 12px;
  background:linear-gradient(150deg,#f7e1a0,#c99a45 30%,#7a5420 70%,#b78a3c 88%,#7a5420);
  box-shadow:0 0 0 1px #3d2a0e,0 6px 12px #28140673,inset 0 1px 0 #fff8dcb3}
.window{position:relative;aspect-ratio:25/31;overflow:hidden;border-radius:121px 121px 7px 7px/112px 112px 7px 7px;
  box-shadow:inset 0 0 0 2px #28140690,inset 0 6px 14px #140a1473}
.window.painted{background:linear-gradient(180deg,#8f6ae8,#6441a5)}
.window img{position:absolute;left:50%;bottom:-4%;width:142%;height:auto;transform:translateX(-50%);image-rendering:auto}
.window::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  box-shadow:inset 0 0 0 2px #28140690,inset 0 8px 18px #140a1466;background:linear-gradient(180deg,#fff6e014,#0000 40%)}
.window.arms{display:grid;place-content:center;justify-items:center;gap:16px;padding:20px;text-align:center;
  background:radial-gradient(70% 55% at 50% 42%,#fbf0d6,#0000 80%),linear-gradient(180deg,#efe1bf,#d6be92)}
.window.arms svg{filter:drop-shadow(0 3px 3px #3a201059)}
.window.arms span{font:italic 400 18px/1.3 ${TEXT};color:#5d4a37;max-width:12em}

.who{min-width:0;padding-top:2px}
.name{font:400 54px/1.02 ${DISPLAY};letter-spacing:.004em;overflow-wrap:break-word;text-wrap:balance;text-shadow:0 1px 0 #fff6de8c}
.name[data-length=mid]{font-size:46px;line-height:1.04}.name[data-length=long]{font-size:34px;line-height:1.1}
[data-book=none] .name{font-size:68px}[data-book=none] .name[data-length=mid]{font-size:56px}[data-book=none] .name[data-length=long]{font-size:44px}
.swatch{display:inline-block;width:.38em;height:.38em;margin:0 .26em .1em 0;border-radius:50%;vertical-align:middle;box-shadow:0 0 0 2px #2c2118,inset 0 -2px 3px #0000004d}
.login{margin-top:4px;font:italic 400 19px/1.25 ${TEXT};color:#5d4a37;overflow-wrap:anywhere}
.realm{margin-top:6px;font:italic 400 34px/1.1 ${DISPLAY};color:#3f2f21;overflow-wrap:anywhere}
[data-book=none] .realm{font-size:38px}
.standing{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;margin-top:10px;font:400 19px/1.3 ${CAPS};letter-spacing:.07em;color:#5d4a37}
.standing i{width:5px;height:5px;transform:rotate(45deg);background:#8a7356}
.flourish{display:block;width:240px;height:16px;margin:12px 0 10px}
.flourish path{fill:none;stroke:#8a7356;stroke-width:1.3;stroke-linecap:round}
.facts{list-style:none;display:flex;flex-wrap:wrap;align-items:start;gap:10px 22px;margin-top:14px;padding-top:12px;border-top:1px solid #8a735640}
.facts .fact{flex:none}.facts .home{flex:1 1 0;min-width:0}.facts .home[data-length=long]{flex-basis:100%}
[data-book=none] .facts{display:grid;grid-template-columns:auto auto;justify-content:start;gap:12px 44px;margin-top:0;padding-top:0;border:0}
[data-book=none] .facts .home{grid-column:1/-1;padding-right:110px}
.fact{display:grid;grid-template-columns:26px minmax(0,1fr);column-gap:10px;align-items:baseline}
.mk{grid-row:span 3;align-self:start;width:26px;height:26px;fill:none;stroke:#5d4a37;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.mk.blank{visibility:hidden}
.label{font:400 14px/1.2 ${CAPS};letter-spacing:.1em;color:#7a6248}
.value{font:400 23px/1.12 ${DISPLAY};color:#2c2118;font-variant-numeric:lining-nums;overflow-wrap:break-word}
.value.unknown{font-style:italic;font-size:20px;color:#5d4a37}
.home[data-length=long] .value{font-size:19px;line-height:1.15}
[data-book=none] .value{font-size:26px}[data-book=none] .value.unknown{font-size:22px}[data-book=none] .home[data-length=long] .value{font-size:22px}
.street{color:#5d4a37}
.street bdi{display:inline-block;max-width:100%}
.note{font:italic 400 16px/1.25 ${TEXT};color:#5d4a37}
.worn{align-self:start;min-width:0;margin-top:2px}
[data-book=none] .worn{align-self:start;margin-top:14px;padding-right:110px}
.worn ul{list-style:none;display:flex;flex-wrap:wrap;gap:3px 16px;margin-top:4px}
.worn li{display:flex;align-items:center;gap:6px;font:italic 400 17px/1.25 ${TEXT};color:#2c2118}
.mk.earned{width:22px;height:22px;flex:none;stroke:#7a2e22}
.seal-slot{position:absolute;left:0;top:262px;transform:rotate(-10deg);filter:drop-shadow(0 3px 3px #2a120880)}
.seal-slot .seal{width:80px;height:80px}
[data-book=none] .seal-slot{left:auto;top:auto;right:10px;bottom:8px}
[data-book=none] .seal-slot .seal{width:96px;height:96px}

.book{position:absolute;z-index:2;left:380px;top:34px;width:800px;height:562px;transform:rotate(2.4deg);
  filter:drop-shadow(0 22px 28px #0b0402c0) drop-shadow(0 5px 8px #0b040290)}
.case{position:relative;width:100%;height:100%;padding:14px 14px 16px;border-radius:10px 12px 12px 10px;
  background:${LEATHER},radial-gradient(ellipse 60% 45% at 70% 18%,#c0745044,transparent 70%),linear-gradient(168deg,#8a4630,#5e2a1b 34%,#3b170e);
  box-shadow:inset 0 0 0 1px #c47a5240,inset 0 0 0 2.5px #240c06,inset 0 0 18px #e09a6a26,inset 0 -6px 14px #12040280}
.case::before{content:'';position:absolute;inset:-3px;z-index:4;border-radius:11px;pointer-events:none;
  background:radial-gradient(circle at calc(100% - 13px) 13px,#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  radial-gradient(circle at calc(100% - 13px) calc(100% - 13px),#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  linear-gradient(225deg,#f5d995 0,#c99a4c 15px,#7c5a24 28px,transparent 28.5px) top right/38px 38px no-repeat,
  linear-gradient(315deg,#e7c47c 0,#b58945 15px,#6e4f20 28px,transparent 28.5px) bottom right/38px 38px no-repeat;
  filter:drop-shadow(0 1px 0 #1a0a0499)}
.spread{position:relative;display:grid;grid-template-columns:1fr 1fr;height:100%;z-index:2}
.spread::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:70px;transform:translateX(-50%);z-index:3;
  background:repeating-linear-gradient(180deg,transparent 0 36px,#e2cfa2 36px 49px,#9c845a 49px 50px,transparent 50px 76px) center/2.6px 100% no-repeat,
  linear-gradient(90deg,transparent,#6b4a2618 26%,#4a2e1440 44%,#2a170a66 50%,#4a2e1440 56%,#6b4a2618 74%,transparent)}
.page{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;overflow:hidden;
  background:${PAGE},radial-gradient(circle at 82% 12%,#b07a3a14 0 9px,transparent 26px),radial-gradient(ellipse 80% 70% at 50% 42%,#fbf3dd,transparent 78%),
  linear-gradient(172deg,#f2e5c4,#e2cfa3)}
.page.left{border-radius:4px 1px 1px 5px;box-shadow:inset -30px 0 34px -20px #7a542a48}
.page.right{padding:22px 26px 18px 50px;border-radius:1px 4px 5px 1px;
  box-shadow:inset 30px 0 34px -20px #7a542a48,1px 1px 0 #cdb68a,2px 2px 0 #efe2c1,3px 3px 0 #d6c197,4px 4px 0 #ebddb9,5px 5px 0 #c8b287,6px 6px 4px #1a0a0466}
.rose{position:absolute;right:40px;bottom:60px;width:150px;fill:none;stroke:#7a5a38;opacity:.3}
.running-head{text-align:center;font:17px/1.2 ${CAPS};letter-spacing:.1em;color:#654a31;padding-bottom:9px;border-bottom:1px solid #8a6a4440;margin:0 6px 4px}
.entries{list-style:none;flex:1;display:grid;grid-template-rows:repeat(2,1fr);min-height:0}
.entry{display:grid;grid-template-columns:148px minmax(0,1fr);align-items:center;gap:14px;min-height:0}
.entry+.entry{border-top:1px dashed #8a6a4430}
.stamp{display:block;overflow:visible;filter:drop-shadow(0 .5px 0 #fff6e055)}
.words{min-width:0;display:grid;gap:3px}
.kingdom{font:400 28px/1.08 ${DISPLAY};color:#38261a;overflow-wrap:break-word}
.kingdom[data-length=mid]{font-size:23px}.kingdom[data-length=long]{font-size:18px;line-height:1.15}
.kind{font:18px/1.3 ${TEXT};color:#38261a}
.date{font:italic 17px/1.3 ${TEXT};color:#654a31}
.further{display:grid;justify-items:center;margin-top:4px;font:italic 16px/1.2 ${TEXT};color:#654a31}
.fleuron{display:block;width:72px;height:20px;margin:0 auto 2px;fill:none;stroke:#654a31}
.fleuron circle{fill:#654a31;stroke:none}
.ribbon{position:absolute;right:120px;bottom:-34px;width:15px;height:54px;z-index:1;
  background:linear-gradient(90deg,#6c1a1a,#a83228 45%,#7a1f1c);clip-path:polygon(0 0,100% 0,100% 100%,50% 82%,0 100%);filter:drop-shadow(1px 2px 1px #0000005a)}

.cover{position:absolute;z-index:2;left:722px;top:64px;width:392px;height:508px;transform:rotate(4.2deg);border-radius:8px 14px 14px 8px;
  display:flex;flex-direction:column;align-items:center;padding:52px 46px 40px;text-align:center;
  background:${LEATHER},radial-gradient(ellipse 70% 50% at 40% 22%,#c0745048,transparent 70%),radial-gradient(ellipse 50% 40% at 78% 86%,#b0603c30,transparent 70%),
  linear-gradient(162deg,#8a4630,#5e2a1b 40%,#3b170e);
  box-shadow:inset 0 0 0 1px #c47a5240,inset 0 0 0 2.5px #240c06,inset 10px 0 14px -6px #12040299,inset 0 0 22px #e09a6a24,
  3px 3px 0 #2a0f08,5px 5px 0 #e9dab4,6px 6px 0 #c8b287,7px 7px 0 #e4d3ab,8px 8px 0 #2a0f08,0 24px 30px #0b0402b8}
.tooling{position:absolute;inset:18px 18px 18px 26px;border-radius:4px;pointer-events:none;
  box-shadow:0 0 0 1.5px #d9b46a,inset 0 0 0 5px #0000,0 0 0 6px #0000,inset 0 0 0 6.5px #d9b46a99;
  filter:drop-shadow(0 1px 0 #1a0804)}
.cover-word{position:relative;margin-top:8px;font:400 34px/1 ${CAPS};letter-spacing:.24em;padding-left:.24em;color:#e8c77e;text-shadow:0 1px 0 #1a0804,0 -1px 0 #f7dfa040}
.cover-rose{position:relative;width:170px;height:170px;margin:34px 0 30px;fill:none;stroke:#e1bd72;opacity:.92;filter:drop-shadow(0 1px 0 #1a0804)}
.cover-label{position:relative;display:grid;gap:6px;justify-items:center;width:100%;padding:12px 16px 14px;border-radius:4px;
  box-shadow:inset 0 0 0 1.5px #d9b46a,inset 0 2px 6px #12040299;background:#00000024}
.cover-of{font:italic 400 17px/1 ${TEXT};color:#d9be8c}
.cover-name{max-width:100%;font:400 34px/1.1 ${DISPLAY};color:#efd08a;text-shadow:0 1px 0 #1a0804;overflow-wrap:anywhere}
.cover-name[data-length=mid]{font-size:28px}.cover-name[data-length=long]{font-size:22px}
.band{position:absolute;top:-2px;bottom:-2px;right:44px;width:16px;background:linear-gradient(90deg,#2a0f08,#5a2a1a 30%,#3b170e 70%,#1a0804);
  box-shadow:-1px 0 0 #c47a5230,1px 0 0 #00000060}

p.mark{position:absolute;z-index:10;right:26px;bottom:10px;display:flex;align-items:baseline;gap:10px;color:#e4c27a;text-shadow:0 1px 2px #000a}
.mark-word{font:21px/1 ${CAPS};letter-spacing:.12em}
.mark-site{font:italic 16px/1 ${TEXT};color:#d6bf98}
.sim{position:absolute;z-index:10;left:18px;top:10px;display:flex;align-items:baseline;gap:8px;padding:6px 12px 7px;border-radius:5px;
  background:linear-gradient(180deg,#a1402a,#7a2c1c);box-shadow:inset 0 1px 0 #ffd0b040,0 2px 6px #0008;color:#fbe9d6;transform:rotate(-1.3deg)}
.sim b{font:17px/1 ${CAPS};letter-spacing:.1em}
.sim span{font:italic 15px/1 ${TEXT};color:#f4d8c0}
`;

