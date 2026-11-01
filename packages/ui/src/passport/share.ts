import { isoDay, longDate, monthSpan } from './format';
import { armsSvg, escapeMarkup, stampSvg } from './markup';
import type { PersonView, StampView, VisiblePassportView, VisitView } from './types';

/**
 * The passport's share image: one deliberate 1200 × 800 composition of the book lying open on a lamp-lit desk.
 * It is the same book the panel and the card page open, drawn from the same markup, ink and record IDs, and it is
 * honest about what it is: a curated current spread. The left page names the holder and shows the arms of the
 * first kingdoms the authority lists; the right page carries the newest journeys exactly in the authority's order.
 * Nothing is counted, ranked or summed, and when the book holds more than the spread shows, the page says the rest
 * is further back in the book. Only a visible book can be composed; a hidden book has nothing to draw.
 *
 * Pure strings, no DOM: the server renders it to PNG (`apps/api/src/passport/share.ts`), and the card page can show
 * the identical document as a preview.
 */
export const SHARE_SIZE = { width: 1200, height: 800 } as const;

/** Journeys on the spread's right page: the book's own spread density, so the image is a page of the real book. */
export const SHARE_STAMPS = 3;
/** Arms of kingdoms reached shown on the flyleaf. */
export const SHARE_KINGDOMS = 6;
/** Accepted gifts written under one journey in the image; the book itself lists all of them. */
export const SHARE_GIFTS = 2;

export interface ShareSpread {
  readonly origin: VisiblePassportView['origin'];
  readonly holder: PersonView;
  readonly asOf: number;
  readonly revision: string;
  /** The newest journeys, in the authority's order, at most `SHARE_STAMPS`. */
  readonly stamps: readonly StampView[];
  /** The book holds journeys beyond those on the spread (more on this page or a further page). */
  readonly moreStamps: boolean;
  /** The first kingdoms reached as the authority lists them, at most `SHARE_KINGDOMS`. */
  readonly kingdoms: readonly VisitView[];
  readonly moreKingdoms: boolean;
  /** The whole book is empty: a named flyleaf and room for the first journey, nothing fabricated. */
  readonly empty: boolean;
}

/** The spread a share image shows, chosen by rule from a visible book and nothing else. */
export function curateShareSpread(book: VisiblePassportView): ShareSpread {
  const collections = [book.stamps, book.kingdoms, book.bonds, book.keepsakes];
  return {
    origin: book.origin, holder: book.holder, asOf: book.asOf, revision: book.revision,
    stamps: book.stamps.items.slice(0, SHARE_STAMPS),
    moreStamps: book.stamps.items.length > SHARE_STAMPS || book.stamps.nextCursor !== null,
    kingdoms: book.kingdoms.items.slice(0, SHARE_KINGDOMS),
    moreKingdoms: book.kingdoms.items.length > SHARE_KINGDOMS || book.kingdoms.nextCursor !== null,
    empty: collections.every(page => page.items.length === 0 && page.nextCursor === null),
  };
}

export interface PassportShare {
  /** A complete HTML document sized exactly `SHARE_SIZE`, with no script and no external resource. */
  readonly html: string;
  /** For `og:title` and the image's own title. */
  readonly title: string;
  /** Everything the image shows, in words, for `og:image:alt` and `alt`. */
  readonly alt: string;
  readonly spread: ShareSpread;
}

export interface ShareOptions {
  /** `@font-face` rules for IM Fell English, IM Fell English SC and Alegreya; the renderer embeds the bytes. */
  readonly fontFaces?: string;
  /** Kingdom names already public beside the book (the card's disclosed homes), so a road can name where it began. */
  readonly places?: ReadonlyMap<string, string>;
  /** The site mark printed on the desk. */
  readonly site?: string;
}

const journeyWords = (stamp: StampView) => stamp.kind === 'raid'
  ? `a raid on ${stamp.kingdom.name}${stamp.leader ? ` led by ${stamp.leader.name}` : ''}, ${longDate(stamp.at)}`
  : `a visit to ${stamp.kingdom.name}, ${longDate(stamp.at)}`;

/** The image in words: who, what the spread shows and when it was written. No totals, because the image has none. */
export function shareAlt(spread: ShareSpread): string {
  const written = ` Written as of ${longDate(spread.asOf)}.`;
  if (spread.stamps.length === 0) {
    return `The passport of ${spread.holder.name}, open on its flyleaf with room for the first journey.${written}`;
  }
  const latest = spread.stamps.map(journeyWords).join('; ');
  const further = spread.moreStamps ? ' Older journeys are further back in the book.' : '';
  return `The passport of ${spread.holder.name}, open on its latest journeys: ${latest}.${further}${written}`;
}

/** A name's length class: long names step down a size instead of being cut. */
const lengthOf = (name: string, short: number, long: number) => {
  const length = [...name].length;
  return length > long ? 'long' : length > short ? 'mid' : 'short';
};

const fleuron = '<svg class="fleuron" viewBox="0 0 80 24" aria-hidden="true"><path d="M4 12h24M52 12h24" stroke-width="1"/>'
  + '<path d="M40 4c-3 4-8 5-12 8 4 3 9 4 12 8 3-4 8-5 12-8-4-3-9-4-12-8Z" stroke-width="1.1"/><circle cx="40" cy="12" r="2"/></svg>';

const roadGlyph = '<svg class="road-glyph" viewBox="0 0 30 12" aria-hidden="true"><circle cx="3" cy="8" r="2"/>'
  + '<path d="M6.5 7.6c4-3.4 8-3.8 11.5-2.2 2.4 1.1 4.4 1.2 6.4-.4" stroke-dasharray="2.4 2"/><path d="M22.6 2.6l3.4 2.1-3.1 2.4"/></svg>';

const rosette = `<svg class="guilloche" viewBox="0 0 200 200" aria-hidden="true">${
  Array.from({ length: 24 }, (_, i) => `<ellipse cx="100" cy="100" rx="92" ry="34" transform="rotate(${i * 7.5} 100 100)"/>`).join('')
}<circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="98.5"/></svg>`;

/** The compass rose with a road across it, the same one tooled into the cover, printed faintly on the flyleaf. */
const compass = '<svg class="compass" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke-width="1.6"/>'
  + '<circle cx="60" cy="60" r="43" fill="none" stroke-width=".8" stroke-dasharray="2 3.4"/><path d="M60 14v92M14 60h92" stroke-width=".8"/>'
  + '<path d="M60 22l7 31 31 7-31 7-7 31-7-31-31-7 31-7Z" stroke-width="1.2"/><path d="M60 37l3 20 20 3-20 3-3 20-3-20-20-3 20-3Z" stroke-width=".8"/>'
  + '<path d="M30 96c10-12 22-6 30-18s20-8 30-22" fill="none" stroke-width="1.3" stroke-dasharray="5 3.4"/></svg>';

const time = (ms: number) => `<time datetime="${isoDay(ms)}">${escapeMarkup(longDate(ms))}</time>`;
const name = (text: string) => `<bdi dir="auto">${escapeMarkup(text)}</bdi>`;

function flyleaf(spread: ShareSpread): string {
  const holder = spread.holder.name;
  const arms = spread.kingdoms.length
    ? `<div class="reached"><p class="label">Kingdoms reached</p><div class="arms-row">${
      spread.kingdoms.map((visit, i) => armsSvg(visit.kingdom.crest, { id: `share-a${i}`, kingdomName: visit.kingdom.name, size: 46, decorative: true })).join('')
    }${spread.moreKingdoms ? '<span class="arms-more" aria-hidden="true">…</span>' : ''}</div></div>`
    : '';
  const note = spread.empty
    ? 'Its pages are waiting for the first kingdom reached. A raid ridden or a gate walked through presses a stamp here.'
    : 'Each stamp was pressed where the world saw the arrival: the raids ridden, the kingdoms walked into, and what was given on the road.';
  return `<article class="page left"><p class="label">This passport belongs to</p>`
    + `<h1 class="holder" data-length="${lengthOf(holder, 14, 26)}">${name(holder)}</h1>${fleuron}`
    + `<p class="note">${escapeMarkup(note)}</p>${arms}<div class="rose">${compass}</div>`
    + `<p class="asof">Written as of ${time(spread.asOf)}</p><span class="folio">1</span></article>`;
}

function entry(stamp: StampView, index: number, places: ReadonlyMap<string, string>): string {
  const from = stamp.kind === 'raid' ? places.get(stamp.road.from) : undefined;
  const kind = stamp.kind === 'raid'
    ? `Raid${stamp.leader ? `, led by ${name(stamp.leader.name)}` : ', its leader not recorded'}`
    : 'Visited';
  const gifts = stamp.gifts.slice(0, SHARE_GIFTS).map(gift =>
    `<li><span class="way">${gift.direction === 'left' ? 'Left' : 'Brought back'}</span> ${name(gift.name)}</li>`).join('');
  const moreGifts = stamp.gifts.length > SHARE_GIFTS ? '<li class="gifts-more">and more written in the book</li>' : '';
  return `<li class="entry" data-flip="${index % 2 === 1}" data-kind="${stamp.kind}">`
    + stampSvg(stamp, { id: `share-s${index}`, size: 150, class: 'stamp-mark' })
    + `<div class="words"><h2 class="kingdom" data-length="${lengthOf(stamp.kingdom.name, 18, 30)}">${name(stamp.kingdom.name)}</h2>`
    + `<p class="kind">${kind}</p><p class="date">${time(stamp.at)}</p>`
    + (from ? `<p class="road">${roadGlyph}By the road from ${name(from)}</p>` : '')
    + (gifts ? `<ul class="gifts">${gifts}${moreGifts}</ul>` : '')
    + '</div></li>';
}

function journeys(spread: ShareSpread, places: ReadonlyMap<string, string>): string {
  if (spread.stamps.length === 0) {
    return `<article class="page right invitation">${rosette}<div class="room" aria-hidden="true"></div>`
      + '<p class="invite-title">Room for the first journey</p><p class="invite-note">No kingdom has stamped this page yet.</p>'
      + '<span class="folio">2</span></article>';
  }
  return `<article class="page right"><p class="running-head">${escapeMarkup(monthSpan(spread.stamps.map(stamp => stamp.at)))}</p>`
    + `<ol class="entries" data-count="${spread.stamps.length}">${spread.stamps.map((stamp, i) => entry(stamp, i, places)).join('')}</ol>`
    + (spread.moreStamps ? `<p class="further">${fleuron}<span>Older journeys are further back in the book</span></p>` : '')
    + '<span class="folio">2</span></article>';
}

/** Dust turning in the lamp's light: fixed motes, the same in every image. */
const MOTES = [[246, 118, 2.2, 0.32], [318, 18, 1.4, 0.5], [902, 132, 1.8, 0.26], [968, 12, 2.6, 0.45], [1150, 210, 1.3, 0.5], [44, 260, 1.6, 0.45],
  [1162, 96, 1.9, 0.4], [420, 46, 1.2, 0.3], [760, 16, 1.6, 0.5], [30, 140, 2.1, 0.4], [598, 300, 1.3, 0.22], [1176, 420, 1.6, 0.35],
  [22, 520, 1.4, 0.35], [700, 210, 1.1, 0.24], [140, 18, 1.8, 0.45]] as const;

export function composePassportShare(book: VisiblePassportView, options: ShareOptions = {}): PassportShare {
  const spread = curateShareSpread(book);
  const places = new Map(options.places ?? []);
  // The book's own records name kingdoms too, so a road from a kingdom it already holds can say so.
  for (const visit of book.kingdoms.items) places.set(visit.kingdom.kingdomId, visit.kingdom.name);
  for (const stamp of book.stamps.items) places.set(stamp.kingdom.kingdomId, stamp.kingdom.name);
  const title = `The passport of ${spread.holder.name}`;
  const alt = shareAlt(spread);
  const motes = MOTES.map(([x, y, r, o]) => `<i style="left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px;opacity:${o}"></i>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    // The picture fetches nothing and runs nothing: fonts and marks are inline, and the policy says so.
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`
    + `<meta name="viewport" content="width=${SHARE_SIZE.width},height=${SHARE_SIZE.height}">`
    + `<title>${escapeMarkup(title)}</title><style>${options.fontFaces ?? ''}${SHARE_CSS}</style></head>`
    + `<body><main class="desk" role="img" aria-label="${escapeMarkup(alt)}">`
    + `<div class="lamp" aria-hidden="true"></div>`
    + `<div class="book"><div class="case"><div class="spread">${flyleaf(spread)}${journeys(spread, places)}</div>`
    + `<span class="ribbon" aria-hidden="true"></span></div></div><div class="motes" aria-hidden="true">${motes}</div>`
    + `<p class="mark"><span class="mark-word">Chatdom</span><span class="mark-site">${escapeMarkup(options.site ?? 'chatdom.gg')}</span></p>`
    + '</main></body></html>';
  return { html, title, alt, spread };
}

const PAPER = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.018' numOctaves='3' seed='9'/%3E%3CfeColorMatrix values='0 0 0 0 .55 0 0 0 0 .38 0 0 0 0 .18 0 0 0 -.9 .55'/%3E%3C/filter%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.7' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 .4 0 0 0 0 .28 0 0 0 0 .14 0 0 0 -1.2 .62'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23m)' opacity='.5'/%3E%3Crect width='260' height='260' filter='url(%23f)' opacity='.35'/%3E%3C/svg%3E\")";
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' stitchTiles='stitch' baseFrequency='.85' numOctaves='3' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .1 0 0 0 0 .04 0 0 0 0 .02 0 0 0 -1.6 1.15'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E\")";
const WOOD = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='160'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.004 .09' numOctaves='3' seed='12'/%3E%3CfeColorMatrix values='0 0 0 0 .16 0 0 0 0 .08 0 0 0 0 .04 0 0 0 -1.4 .9'/%3E%3C/filter%3E%3Crect width='600' height='160' filter='url(%23w)'/%3E%3C/svg%3E\")";

/* The image's own stylesheet. Every text colour on parchment is the kit's ink (#38261a, >10:1) or soft ink (#654a31,
   >4.5:1); on the desk it is cream or worn gilt. Nothing below 15 px, so it still reads at a third of its size. */
const SHARE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:800px;overflow:hidden;background:#140c08}
body{font-family:Alegreya,Georgia,'Times New Roman',serif;color:#38261a;font-synthesis:none;-webkit-font-smoothing:antialiased}
bdi{unicode-bidi:isolate}
.desk{position:relative;width:1200px;height:800px;overflow:hidden;
  background:radial-gradient(circle at 104% -6%,#ffb25a55,#ff8a3a1c 22%,transparent 42%),
  radial-gradient(ellipse 62% 58% at 50% 44%,#7a4e2e 0,#4a2e1c 46%,transparent 78%),
  ${WOOD},
  repeating-linear-gradient(91deg,#ffdcae08 0 3px,transparent 3px 13px,#0a040214 13px 14px,transparent 14px 27px),
  linear-gradient(180deg,#2c1d14,#1c120c 70%,#120b08)}
.desk::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 80% 75% at 50% 46%,transparent 55%,#0a0503b0 100%)}
.lamp{position:absolute;inset:-120px -60px auto;height:640px;pointer-events:none;mix-blend-mode:screen;
  background:radial-gradient(ellipse 44% 50% at 50% 30%,#ffc77a3a,#ff9e4a14 50%,transparent 72%),
  conic-gradient(from 168deg at 50% -10%,transparent 0deg,#ffd9a00f 6deg,#ffd9a018 12deg,#ffd9a00f 18deg,transparent 24deg)}
.motes{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen}
.motes i{position:absolute;border-radius:50%;background:radial-gradient(circle,#fff1d0,#ffd38a80 45%,transparent 70%);filter:blur(.3px)}
.book{position:absolute;left:84px;top:30px;width:1032px;height:694px;transform:rotate(-1.1deg);
  filter:drop-shadow(0 26px 34px #0b0402c0) drop-shadow(0 6px 10px #0b040290)}
.case{position:relative;width:100%;height:100%;padding:16px 16px 18px;border-radius:10px 12px 12px 10px;
  background:${GRAIN},radial-gradient(ellipse 60% 45% at 26% 18%,#c0745044,transparent 70%),
  radial-gradient(ellipse 45% 40% at 78% 84%,#b0603c30,transparent 70%),linear-gradient(168deg,#8a4630,#5e2a1b 34%,#3b170e);
  box-shadow:inset 0 0 0 1px #c47a5240,inset 0 0 0 2.5px #240c06,inset 0 0 18px #e09a6a26,inset 0 -6px 14px #12040280}
.case::before{content:'';position:absolute;inset:-3px;z-index:4;border-radius:11px;
  background:radial-gradient(circle at 13px 13px,#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  radial-gradient(circle at calc(100% - 13px) 13px,#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  radial-gradient(circle at 13px calc(100% - 13px),#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  radial-gradient(circle at calc(100% - 13px) calc(100% - 13px),#fff3cf 0 1.4px,#6e4e1e 2px 2.9px,transparent 3.3px),
  linear-gradient(135deg,#f5d995 0,#c99a4c 15px,#7c5a24 28px,transparent 28.5px) top left/38px 38px no-repeat,
  linear-gradient(225deg,#f5d995 0,#c99a4c 15px,#7c5a24 28px,transparent 28.5px) top right/38px 38px no-repeat,
  linear-gradient(45deg,#e7c47c 0,#b58945 15px,#6e4f20 28px,transparent 28.5px) bottom left/38px 38px no-repeat,
  linear-gradient(315deg,#e7c47c 0,#b58945 15px,#6e4f20 28px,transparent 28.5px) bottom right/38px 38px no-repeat;
  filter:drop-shadow(0 1px 0 #1a0a0499) drop-shadow(0 2px 2px #0000004d)}
.spread{position:relative;display:grid;grid-template-columns:1fr 1fr;height:100%;z-index:2}
.spread::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:76px;transform:translateX(-50%);z-index:3;
  background:repeating-linear-gradient(180deg,transparent 0 36px,#e2cfa2 36px 49px,#9c845a 49px 50px,transparent 50px 76px) center/2.6px 100% no-repeat,
  linear-gradient(90deg,transparent,#6b4a2618 26%,#4a2e1440 44%,#2a170a66 50%,#4a2e1440 56%,#6b4a2618 74%,transparent)}
.page{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;overflow:hidden;padding:34px 46px 40px;
  background:${PAPER},radial-gradient(circle at 82% 12%,#b07a3a14 0 9px,transparent 26px),radial-gradient(circle at 14% 88%,#a0703418 0 6px,transparent 22px),
  radial-gradient(ellipse 80% 70% at 50% 42%,#fbf3dd,transparent 78%),linear-gradient(172deg,#f2e5c4,#e2cfa3)}
.page.left{padding-right:58px;border-radius:4px 1px 1px 5px;box-shadow:inset -30px 0 34px -20px #7a542a48,
  -1px 1px 0 #cdb68a,-2px 2px 0 #efe2c1,-3px 3px 0 #d6c197,-4px 4px 0 #ebddb9,-5px 5px 0 #c8b287,-6px 6px 4px #1a0a0466}
.page.right{padding-left:58px;border-radius:1px 4px 5px 1px;box-shadow:inset 30px 0 34px -20px #7a542a48,
  1px 1px 0 #cdb68a,2px 2px 0 #efe2c1,3px 3px 0 #d6c197,4px 4px 0 #ebddb9,5px 5px 0 #c8b287,6px 6px 4px #1a0a0466}
.page::after{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 70% 60% at 40% 30%,#fff3d016,transparent 70%)}
.folio{position:absolute;bottom:16px;font:15px/1 'IM Fell English',Georgia,serif;color:#654a31}
.left .folio{left:46px}.right .folio{right:46px}
.label{font:16px/1.2 'IM Fell English SC',Georgia,serif;letter-spacing:.08em;color:#654a31}
.fleuron{display:block;width:96px;height:28px;margin:14px auto;fill:none;stroke:#654a31}
.fleuron circle{fill:#654a31;stroke:none}
.left{align-items:center;text-align:center}
.left>.label{margin-top:52px}
.holder{margin-top:14px;max-width:100%;font:400 50px/1.06 'IM Fell English',Georgia,serif;color:#38261a;overflow-wrap:anywhere;text-wrap:balance}
.holder[data-length=mid]{font-size:42px}.holder[data-length=long]{font-size:34px}
.note{max-width:370px;font:italic 19px/1.45 Alegreya,Georgia,serif;color:#654a31;text-wrap:pretty}
.reached{margin-top:34px;display:grid;justify-items:center;gap:12px}
.arms-row{display:flex;align-items:center;justify-content:center;gap:12px}
.arms-row svg{filter:drop-shadow(0 2px 1.5px #3a20104d)}
.arms-more{font:28px/1 'IM Fell English',Georgia,serif;color:#654a31}
.rose{flex:1;display:grid;place-items:center;min-height:0;width:100%}
.compass{width:min(150px,70%);max-height:100%;fill:none;stroke:#7a5a38;opacity:.32}
.asof{margin-bottom:18px;font:16px/1.3 'IM Fell English SC',Georgia,serif;letter-spacing:.06em;color:#654a31}
.running-head{text-align:center;font:16px/1.2 'IM Fell English SC',Georgia,serif;letter-spacing:.1em;color:#654a31;padding-bottom:10px;
  border-bottom:1px solid #8a6a4440;margin:0 12px 6px}
.entries{list-style:none;flex:1;display:grid;grid-template-rows:repeat(3,1fr);min-height:0}
.entry{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:16px;min-height:0;padding:4px 0}
.entry[data-flip=true]{grid-template-columns:1fr 150px}
.entry[data-flip=true] .stamp-mark{order:2}
.entry[data-flip=true] .words{text-align:right}
.stamp-mark{display:block;overflow:visible;filter:drop-shadow(0 .5px 0 #fff6e055)}
.words{min-width:0;display:grid;gap:2px}
.kingdom{font:400 25px/1.1 'IM Fell English',Georgia,serif;color:#38261a;overflow-wrap:anywhere}
.kingdom[data-length=mid]{font-size:21px}.kingdom[data-length=long]{font-size:18px;line-height:1.15}
.kind{font:17px/1.3 Alegreya,Georgia,serif;color:#38261a}
.date{font:italic 16px/1.3 Alegreya,Georgia,serif;color:#654a31}
.road{display:flex;align-items:center;gap:6px;font:16px/1.3 Alegreya,Georgia,serif;color:#654a31}
.entry[data-flip=true] .road{justify-content:flex-end}
.road-glyph{flex:none;width:30px;height:12px;fill:none;stroke:#654a31;stroke-width:1.4;stroke-linecap:round}
.road-glyph circle{fill:#654a31;stroke:none}
.gifts{list-style:none;margin-top:2px;font:15px/1.3 Alegreya,Georgia,serif;color:#38261a}
.way{font:15px/1 'IM Fell English SC',Georgia,serif;letter-spacing:.06em;color:#654a31}
.gifts-more{font-style:italic;color:#654a31}
.further{display:grid;justify-items:center;gap:0;margin:6px 0 8px;font:italic 16px/1.2 Alegreya,Georgia,serif;color:#654a31}
.further .fleuron{margin:0 auto 4px;width:72px;height:20px}
.invitation{align-items:center;justify-content:center;text-align:center}
.guilloche{position:absolute;left:50%;top:44%;width:380px;height:380px;transform:translate(-50%,-50%);fill:none;stroke:#8a6a44;stroke-width:.45;opacity:.42}
.room{position:relative;width:190px;height:190px;border-radius:50%;margin-top:-60px;border:2px dashed #8a6a4466;box-shadow:inset 0 0 0 10px #f2e5c4,inset 0 0 0 11px #8a6a4430}
.invite-title{position:relative;margin-top:44px;font:400 30px/1.15 'IM Fell English',Georgia,serif;color:#38261a}
.invite-note{position:relative;margin-top:8px;font:italic 18px/1.4 Alegreya,Georgia,serif;color:#654a31}
.ribbon{position:absolute;left:calc(50% + 18px);bottom:-30px;width:15px;height:52px;z-index:1;
  background:linear-gradient(90deg,#6c1a1a,#a83228 45%,#7a1f1c);clip-path:polygon(0 0,100% 0,100% 100%,50% 82%,0 100%);filter:drop-shadow(1px 2px 1px #0000005a)}
p.mark{position:absolute;right:30px;bottom:14px;display:flex;align-items:baseline;gap:12px;color:#e4c27a;text-shadow:0 1px 2px #000a}
.mark-word{font:22px/1 'IM Fell English SC',Georgia,serif;letter-spacing:.12em}
.mark-site{font:italic 16px/1 Alegreya,Georgia,serif;color:#d6bf98}
`;
