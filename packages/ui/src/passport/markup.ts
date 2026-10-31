import { CHARGE, SHIELD, blazonOf, chargeTransform } from './crest';
import { stampDate } from './format';
import { contrast, crestInks, inkFor, parseHex, type Ink } from './ink';
import type { CrestView, StampView } from './types';

/**
 * The passport's drawn marks as SVG markup: the inked stamp with its wax seal, and the painted arms. Pure strings
 * with no DOM, so the book in a browser (`PassportStampMark`, `CrestArms`) and the share image on the server draw
 * every journey from the same lines, the same ink and the same record ID. Every value placed in markup is either a
 * number this module computed, a `#rrggbb` tincture the frozen schema already checked, or escaped text.
 */

/** Text and attribute values for XML and HTML: the five characters that could break out of either. */
export function escapeMarkup(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** An element ID prefix: letters, digits, `-` and `_` only, so it can sit in `url(#…)` unquoted. */
function safeId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '');
  return /^[A-Za-z]/.test(clean) ? clean : `m${clean}`;
}

/** Only checked tinctures reach a fill: anything else is refused rather than written into markup. */
function tincture(hex: string): string {
  parseHex(hex);
  return hex;
}

const attrs = (values: Readonly<Record<string, string | number | undefined>>) =>
  Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escapeMarkup(String(value))}"`).join('');

/* ---------- The charge ---------- */

/** The charge of a crest in one tincture: filled parts even-odd, wave bands stroked. Shared by arms, ink and wax. */
export function chargeMarkup(crest: Pick<CrestView, 'shape' | 'charge'>, fill: string, outline?: { colour: string; width?: number }): string {
  const art = CHARGE[crest.charge];
  const width = outline?.width ?? 1.2;
  let out = `<g transform="${chargeTransform(crest.shape)}">`;
  if (outline) {
    if (art.fill) out += `<path d="${art.fill}" fill="none" stroke="${outline.colour}" stroke-width="${width * 2}" stroke-linejoin="round"/>`;
    if (art.stroke) out += `<path d="${art.stroke}" fill="none" stroke="${outline.colour}" stroke-width="${(art.strokeWidth ?? 6) + width * 2}" stroke-linecap="round"/>`;
  }
  if (art.fill) out += `<path d="${art.fill}" fill="${fill}" fill-rule="evenodd"/>`;
  if (art.stroke) out += `<path d="${art.stroke}" fill="none" stroke="${fill}" stroke-width="${art.strokeWidth}" stroke-linecap="round"/>`;
  return `${out}</g>`;
}

/* ---------- The painted arms ---------- */

/** The inner markup of the arms in a 100 × 110 box: field, charge, bordure and chief from the crest's tinctures. */
export function armsMarkup(crest: CrestView, id: string): string {
  const key = safeId(id);
  const colours = crest.colours.map(tincture);
  const field = colours[0]!;
  const charge = colours[1] ?? field;
  const shield = SHIELD[crest.shape];
  // A charge that would vanish into its field (pale on pale) is fimbriated in ink, as a herald would.
  const outline = contrast(parseHex(field), parseHex(charge)) < 1.6 ? { colour: '#3a2618' } : undefined;
  const chief = colours[3]
    ? `<rect width="100" height="27" fill="${colours[3]}"/><path d="M0 27H100" stroke="#24160d" stroke-opacity=".45" stroke-width="1.2"/>`
    : '';
  const bordure = colours[2] ? `<path d="${shield}" fill="none" stroke="${colours[2]}" stroke-width="15"/>` : '';
  return `<defs><clipPath id="${key}-clip"><path d="${shield}"/></clipPath>`
    + `<linearGradient id="${key}-wash" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#fff6e0" stop-opacity=".38"/>`
    + `<stop offset=".45" stop-color="#fff6e0" stop-opacity="0"/><stop offset="1" stop-color="#1a0c04" stop-opacity=".32"/></linearGradient></defs>`
    + `<g clip-path="url(#${key}-clip)"><rect width="100" height="110" fill="${field}"/>${chief}`
    + `<g${colours[3] ? ' transform="translate(7 13) scale(.86)"' : ''}>${chargeMarkup(crest, charge, outline)}</g>`
    + `${bordure}<rect width="100" height="110" fill="url(#${key}-wash)"/></g>`
    + `<path d="${shield}" fill="none" stroke="#24160d" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<path d="${shield}" fill="none" stroke="#fff3d6" stroke-opacity=".35" stroke-width=".9" transform="translate(.8 1)" stroke-linejoin="round"/>`;
}

/** A whole `<svg>` of the arms. Decorative arms are hidden from assistive technology; named arms carry a blazon. */
export function armsSvg(crest: CrestView, options: { id: string; kingdomName: string; size: number; class?: string; decorative?: boolean }): string {
  const label = options.decorative ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': `Arms of ${options.kingdomName}: ${blazonOf(crest.shape, crest.charge)}` };
  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ class: options.class ? `pp-arms ${options.class}` : 'pp-arms', viewBox: '0 0 100 110', width: options.size, height: Math.round(options.size * 110) / 100, ...label })}>`
    + `${armsMarkup(crest, options.id)}</svg>`;
}

/* ---------- The inked stamp ---------- */

/** Ink that bled into the fibres and skipped where the pad was thin: displaced edges, blotches and pinholes. */
function brokenInk(id: string, ink: Ink): string {
  return `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${ink.grain}" result="fibre"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="fibre" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="bled"/>`
    + `<feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="${ink.grain + 11}" result="blot"/>`
    + `<feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.4 0 0 0 2.3" result="patchy"/>`
    + `<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed="${ink.grain + 29}" result="pin"/>`
    + `<feColorMatrix in="pin" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -10 0 0 0 6.7" result="pinholes"/>`
    + `<feComposite in="bled" in2="patchy" operator="in" result="patched"/>`
    + `<feComposite in="patched" in2="pinholes" operator="in"/></filter>`;
}

interface Frame { readonly id: string; readonly word: string; readonly date: string; readonly accent: string; readonly crest: CrestView; readonly raid: boolean }

const LABEL = `font-family="'IM Fell English SC', Georgia, serif" stroke="none"`;

/** A short road, walked: dashes ending in a chevron, under the word RAID. */
function road(x: number, y: number, width: number, colour: string): string {
  return `<g stroke="${colour}" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M${x} ${y}h${width - 8}" stroke-width="2" stroke-dasharray="4.5 3.2"/>`
    + `<path d="M${x + width - 9} ${y - 4}l5 4l-5 4" stroke-width="2"/></g>`;
}

/** A diamond rule: a visit is a quiet arrival, not a march. */
function rule(x: number, y: number, width: number, colour: string): string {
  const mid = x + width / 2;
  return `<g stroke="${colour}" fill="none" stroke-width="1.4" stroke-linecap="round">`
    + `<path d="M${x} ${y}H${mid - 6}M${mid + 6} ${y}H${x + width}"/>`
    + `<path d="M${mid} ${y - 3.5}l3.5 3.5l-3.5 3.5l-3.5-3.5Z" fill="${colour}"/></g>`;
}

function ringFrame(f: Frame): string {
  return `<g><circle cx="80" cy="80" r="70" fill="none" stroke-width="3.4"/><circle cx="80" cy="80" r="64.5" fill="none" stroke-width="1.1"/>`
    + `<circle cx="80" cy="80" r="48" fill="none" stroke-width="1.6"/>`
    + `<circle cx="23.5" cy="80" r="2.6" stroke="none"/><circle cx="136.5" cy="80" r="2.6" stroke="none"/>`
    + `<text ${LABEL} font-size="14" letter-spacing="3" text-anchor="middle"><textPath href="#${f.id}-top" startOffset="50%">${f.word}</textPath></text>`
    + `<text ${LABEL} font-size="11.5" letter-spacing="1.6" text-anchor="middle" fill="${f.accent}"><textPath href="#${f.id}-bottom" startOffset="50%">${f.date}</textPath></text>`
    + `<g transform="translate(80 80) scale(.74) translate(-50 -56)" stroke="none">${chargeMarkup({ shape: 'round', charge: f.crest.charge }, 'currentColor')}</g>`
    + `${f.raid ? road(62, 118, 36, f.accent) : ''}</g>`;
}

function cartoucheFrame(f: Frame): string {
  const outer = 'M28 12H132L148 28V132L132 148H28L12 132V28Z', inner = 'M31 18H129L142 31V129L129 142H31L18 129V31Z';
  return `<g><path d="${outer}" fill="none" stroke-width="3.2" stroke-linejoin="round"/><path d="${inner}" fill="none" stroke-width="1.1" stroke-linejoin="round"/>`
    + `<text ${LABEL} x="80" y="40" font-size="15" letter-spacing="3.2" text-anchor="middle">${f.word}</text>`
    + (f.raid ? road(56, 48, 48, f.accent) : rule(52, 48, 56, f.accent))
    + `<g transform="translate(80 91) scale(.54) translate(-50 -56)"><path d="${SHIELD.heater}" fill="none" stroke-width="4.4" stroke-linejoin="round"/>`
    + `<g stroke="none">${chargeMarkup(f.crest, 'currentColor')}</g></g>`
    + `<text ${LABEL} x="80" y="136" font-size="12.5" letter-spacing="1.6" text-anchor="middle" fill="${f.accent}">${f.date}</text></g>`;
}

function ribbonFrame(f: Frame): string {
  const outer = 'M8 38H152L136 80L152 122H8L24 80Z', inner = 'M17 44H143L129 80L143 116H17L31 80Z';
  return `<g><path d="${outer}" fill="none" stroke-width="3.2" stroke-linejoin="round"/><path d="${inner}" fill="none" stroke-width="1.1" stroke-linejoin="round"/>`
    + `<g transform="translate(57 80) scale(.52) translate(-50 -55)"><path d="${SHIELD.swallowtail}" fill="none" stroke-width="4.8" stroke-linejoin="round"/>`
    + `<g stroke="none">${chargeMarkup(f.crest, 'currentColor')}</g></g>`
    + `<text ${LABEL} x="108" y="77" font-size="14.5" letter-spacing="2.6" text-anchor="middle">${f.word}</text>`
    + (f.raid ? road(88, 86, 40, f.accent) : rule(88, 86, 40, f.accent))
    + `<text ${LABEL} x="108" y="104" font-size="10.5" letter-spacing="1.1" text-anchor="middle" fill="${f.accent}">${f.date}</text></g>`;
}

const SEAT: readonly (readonly [number, number])[] = [[128, 126], [126, 34], [34, 128], [36, 36]];

/** The poured outline of a seal: a circle with three ripples and one lip where the wax ran, all from the record. */
function pourOutline(ink: Ink, radius: number): string {
  const [a, b, c] = ink.pour;
  const points: string[] = [];
  const steps = 36;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = radius * (1 + Math.sin(t * 3 + a * 6.28) * 0.055 + Math.sin(t * 5 + b * 6.28) * 0.04 + Math.sin(t * 9 + c * 6.28) * 0.025
      + (Math.cos(t - c * 6.28) > 0.93 ? 0.12 : 0));
    points.push(`${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

/** Sealing wax poured from the arms' strongest tincture, pressed with the charge and then with a thumb. */
function waxSeal(id: string, crest: CrestView, ink: Ink): string {
  const inks = crestInks(crest);
  const [x, y] = SEAT[ink.sealCorner]!;
  const outline = pourOutline(ink, 25);
  const charge = CHARGE[crest.charge];
  const relief = ([[-1.5, -1.6, inks.waxHi, 0.8], [1.6, 1.9, inks.waxLo, 0.9], [0, 0, inks.wax, 1]] as const).map(([dx, dy, colour, opacity]) =>
    `<g transform="translate(${dx} ${dy})" opacity="${opacity}">`
    + (charge.fill ? `<path d="${charge.fill}" fill="${colour}" fill-rule="evenodd"/>` : '')
    + (charge.stroke ? `<path d="${charge.stroke}" fill="none" stroke="${colour}" stroke-width="${charge.strokeWidth}" stroke-linecap="round"/>` : '')
    + '</g>').join('');
  const ridges = Array.from({ length: 8 }, (_, i) => {
    const rx = 3.5 + i * 2.6;
    return `<ellipse rx="${rx.toFixed(1)}" ry="${(rx * 1.32).toFixed(3)}" stroke-dasharray="${7 + (i % 3) * 3} ${1.4 + (i % 2)}"/>`;
  }).join('');
  return `<g class="pp-wax" transform="translate(${x} ${y}) rotate(${ink.sealTurn})"><defs>`
    + `<radialGradient id="${id}-body" cx=".36" cy=".32" r=".78"><stop offset="0" stop-color="${inks.waxHi}"/><stop offset=".46" stop-color="${inks.wax}"/><stop offset="1" stop-color="${inks.waxLo}"/></radialGradient>`
    + `<clipPath id="${id}-clip"><path d="${outline}"/></clipPath>`
    + `<filter id="${id}-drop" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0.6" dy="1.8" stdDeviation="1.4" flood-color="#2a1208" flood-opacity=".5"/></filter>`
    + `</defs><path d="${outline}" fill="url(#${id}-body)" filter="url(#${id}-drop)"/><g clip-path="url(#${id}-clip)">`
    // The matrix's pressed ring and the field it leaves inside.
    + `<circle r="17.6" fill="${inks.waxLo}" fill-opacity=".22"/><circle r="17.6" fill="none" stroke="${inks.waxLo}" stroke-width="2.2"/>`
    + `<circle r="17.6" fill="none" stroke="${inks.waxHi}" stroke-opacity=".6" stroke-width=".8" transform="translate(.7 .9)"/>`
    // The charge in relief: lit on its upper edge, shadowed below.
    + `<g transform="scale(.42) translate(-50 -53)">${relief}</g>`
    // A thumb pressed the cooling wax beside the matrix: its ridges, faint and broken.
    + `<g transform="rotate(${ink.thumbTurn}) translate(13 3)" fill="none" stroke="${inks.waxLo}" stroke-opacity=".34" stroke-width=".7">${ridges}</g>`
    + `<ellipse cx="-8" cy="-11" rx="8" ry="4.6" fill="#fff4e6" fill-opacity=".22" transform="rotate(-28 -8 -11)"/></g></g>`;
}

/**
 * The inner markup of one kingdom's stamp in a 160 × 160 box. The frame follows the arms' own shape (a ring for a
 * round shield, a cartouche for a heater, a cut ribbon for a swallowtail) and carries the charge; the ink is the
 * arms' darkest tincture. A raid also carries a wax seal poured from the arms' strongest colour, pressed with the
 * charge and a thumb. Tilt, slip, pressure, dry patches, broken edges and the seal's corner all come from the
 * record ID, so the same journey lands the same way on every surface.
 */
export function stampMarkup(stamp: StampView, id: string): string {
  const key = safeId(id);
  const ink = inkFor(stamp.id);
  const inks = crestInks(stamp.kingdom.crest);
  const raid = stamp.kind === 'raid';
  const frame: Frame = { id: key, word: raid ? 'RAID' : 'VISIT', date: escapeMarkup(stampDate(stamp.at)), accent: inks.accent, crest: stamp.kingdom.crest, raid };
  const place = `translate(${(ink.dx * 160).toFixed(1)} ${(ink.dy * 160).toFixed(1)}) rotate(${ink.rotate} 80 80)`;
  const shape = stamp.kingdom.crest.shape;
  const drawn = shape === 'round' ? ringFrame(frame) : shape === 'heater' ? cartoucheFrame(frame) : ribbonFrame(frame);
  return `<defs>${brokenInk(`${key}-ink`, ink)}`
    + `<linearGradient id="${key}-dry" gradientTransform="rotate(${ink.dryAngle} .5 .5)"><stop offset="0" stop-color="#fff" stop-opacity="1"/>`
    + `<stop offset=".62" stop-color="#fff" stop-opacity=".92"/><stop offset="1" stop-color="#fff" stop-opacity=".42"/></linearGradient>`
    + `<mask id="${key}-pad" maskUnits="userSpaceOnUse" x="-20" y="-20" width="200" height="200"><rect x="-20" y="-20" width="200" height="200" fill="url(#${key}-dry)"/></mask>`
    + `<path id="${key}-top" d="M28 80A52 52 0 0 1 132 80"/><path id="${key}-bottom" d="M19 80A61 61 0 0 0 141 80"/></defs>`
    + `<g class="pp-stamp-impression" transform="${place}" mask="url(#${key}-pad)">`
    + `<g filter="url(#${key}-ink)" opacity="${ink.pressure}" fill="${inks.ink}" stroke="${inks.ink}" color="${inks.ink}">${drawn}</g></g>`
    + (raid ? waxSeal(`${key}-wax`, stamp.kingdom.crest, ink) : '');
}

/** A whole `<svg>` of the stamp, decorative: the caption beside it carries every fact in text. */
export function stampSvg(stamp: StampView, options: { id: string; size: number; class?: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
    class: options.class ? `pp-stamp ${options.class}` : 'pp-stamp', 'data-kind': stamp.kind, 'data-shape': stamp.kingdom.crest.shape,
    viewBox: '0 0 160 160', width: options.size, height: options.size, 'aria-hidden': 'true',
  })}>${stampMarkup(stamp, options.id)}</svg>`;
}
