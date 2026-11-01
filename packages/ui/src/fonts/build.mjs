#!/usr/bin/env node
// Rebuilds the name faces: the world scripts every Twitch display name may use, served from our own origin.
//
//   node packages/ui/src/fonts/build.mjs                 fetch the pinned packages with `npm pack` into a fresh /tmp dir
//   node packages/ui/src/fonts/build.mjs --from <dir>    use packages already in <dir>: pinned tarballs
//                                                       (`<scope>-<name>-<version>.tgz`, checked against the pinned
//                                                       integrity) or extracted folders (`<any>/package/package.json`)
//
// It copies only the files we serve (world faces at 400 normal, Alegreya's extra variable subsets), each package's
// OFL beside them, and writes packages/ui/src/fonts.css. Everything it reads from the packages is treated as data:
// tarballs are unpacked with system tar into fresh directories, nothing from them is executed, and every range is
// re-derived here rather than trusted.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const FONTS = dirname(fileURLToPath(import.meta.url));
const UI_SRC = resolve(FONTS, '..');
const WORLD = join(FONTS, 'world');
const CSS_OUT = join(UI_SRC, 'fonts.css');
const LATIN_ROMAN = join(FONTS, 'alegreya-roman-latin.woff2');

// --- Unicode blocks ---------------------------------------------------------------------------------------------

/** @typedef {[number, number]} Span */

const ARABIC = spans('0600-06FF 0750-077F 0870-08FF FB50-FDFF FE70-FEFE'); // FEFF is the BOM: the Latin face owns it.
const HEBREW = spans('0590-05FF FB1D-FB4F');
const DEVANAGARI = spans('0900-097F A8E0-A8FF 1CD0-1CFF');
const THAI = spans('0E00-0E7F');
// Han and its furniture, shared by every CJK family: radicals, ideographic description, CJK symbols and punctuation,
// bopomofo and its extension (Taiwanese names use it), kanbun, strokes, enclosed CJK letters and months, CJK
// compatibility, extension A, unified ideographs, compatibility ideographs, vertical and compatibility forms, small
// form variants, halfwidth and fullwidth forms, ideographic symbols, enclosed ideographic supplement, extensions B on.
const HAN = spans(
  '2E80-2FDF 2FF0-2FFF 3000-303F 3100-312F 3190-31EF 3200-32FF 3300-33FF 3400-4DBF 4E00-9FFF F900-FAFF ' +
  'FE10-FE1F FE30-FE4F FE50-FE6F FF00-FFEF 16FE0-16FFF 1F200-1F2FF 20000-323AF',
);
const KANA = spans('3040-30FF 31F0-31FF 1B000-1B16F');
const HANGUL = spans('1100-11FF 3130-318F A960-A97F AC00-D7FF');

// Alegreya's own vertical metrics are read from the shipped Latin file below; these are what fonttools reports for
// it (packages/ui/src/fonts/metrics.py) and the build refuses to run if the file disagrees.
const ALEGREYA_EXPECTED = { unitsPerEm: 1000, ascent: 1016, descent: 345, lineGap: 0 };

// --- What we take, pinned ---------------------------------------------------------------------------------------

const ALEGREYA = {
  name: '@fontsource-variable/alegreya',
  version: '5.3.0',
  integrity: 'sha512-K+DFrm7tnqsG6di2w3eW/o4Ic6XNFLtZCKcPldeHEnE9f8uWy4llIp1CqQAu+ByI9MFfs1C7eLv4Rv84yEIerw==',
  subsets: ['latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'],
  licence: 'OFL-Alegreya-fontsource.txt',
};

/**
 * World faces. `size` is the size-adjust in percent, chosen so each script sits optically level with Alegreya at
 * the same font size; `why` is the reasoning, written into fonts.css beside the faces. Glyph heights quoted are
 * ink extents in em, measured with metrics.py. Alegreya: x-height 0.456, cap H 0.646, ascender l 0.742.
 */
const WORLD_FACES = [
  {
    name: '@fontsource/noto-naskh-arabic', version: '5.3.0', dir: 'arabic', family: 'Chatdom Arabic',
    integrity: 'sha512-S/GDgQ6mh/PKo4mz5+eXNYbEarvpI7yh6eCdOz8tTVbeM7+OUiacIEscaYEibr/+egDtGbO2ZB00sjy1bJC1kQ==',
    blocks: ARABIC, size: 100,
    why: 'Naskh reads small on its body: alif stands 0.671em and the teeth 0.34em. At 100% alif lands just above Alegreya\'s capitals (0.646em) and the teeth sit under its x-height, the usual pairing for Naskh beside a Latin book face; any smaller and Arabic looks a size down. Yeh hangs 0.434em, inside .cd-name\'s leading; a kasra under it (0.63em) overhangs but is never clipped.',
  },
  {
    name: '@fontsource/noto-serif-hebrew', version: '5.3.0', dir: 'hebrew', family: 'Chatdom Hebrew',
    integrity: 'sha512-UbTqdsCCQRYAxQ1ZNjWTcL+tbqYvCG0nhCSD0Y2CmWEfl32e71/DAlRw9IvhjEdCJnKJm0t9AOfiNiut1mHKeA==',
    blocks: HEBREW, size: 92,
    why: 'Hebrew letters stand 0.647em, 0.91 of Noto\'s own capitals (0.714em). At 92% they stand 0.595em, 0.92 of Alegreya\'s capitals: the same share, a touch fuller because Hebrew has no ascenders to carry its colour.',
  },
  {
    name: '@fontsource/noto-serif-devanagari', version: '5.3.0', dir: 'devanagari', family: 'Chatdom Devanagari',
    integrity: 'sha512-POketgM+TcAbtQCpl5GUmlCVvV7zGnFmLlQTIVxp0ePZkKTJ1UhpeyscIpgljOzHjrVzXPj7x1lSXl2W/wI3Gg==',
    blocks: DEVANAGARI, size: 90,
    why: 'The headline sits at 0.623em, 0.87 of Noto\'s capitals. Alegreya\'s x-height is small for its capitals, so matching Noto\'s x-height ratio (85%) leaves Devanagari a size down; 90% hangs the headline at 0.561em, again 0.87 of Alegreya\'s capitals. The i-matra (0.81em) and lower marks (0.38em with conjuncts) stay inside .cd-name\'s leading.',
  },
  {
    name: '@fontsource/noto-serif-thai', version: '5.3.0', dir: 'thai', family: 'Chatdom Thai',
    integrity: 'sha512-BPE5PdY1NqA/aIvFhJz5Bgp/mL/ZS6eWJJXtpG+rlpK5sNXWcJilRBy2kdZfOZFamk5+r9lWFpq6cIRxWVMftQ==',
    blocks: THAI, size: 92,
    why: 'Thai consonants stand 0.558em, 1.04x Noto\'s Latin x-height. At 92% they stand 0.513em, 1.13x Alegreya\'s x-height: a little fuller than Noto\'s pairing so the loops stay open at 12px, while stacked vowels and tone marks (0.95em) and below vowels (0.40em) stay inside .cd-name\'s leading.',
  },
  ...['jp', 'kr', 'tc', 'sc'].map((key) => ({
    name: `@fontsource/noto-serif-${key}`, version: '5.3.1', dir: key, family: `Chatdom ${key.toUpperCase()}`,
    integrity: {
      jp: 'sha512-ewMVFXmG1Ip5u1Po1E1M3qqm8hsFqja0/26vkoaNylPXW9pnmEcBREqXxp+Fs03wpmhICE6qyYBN2bbfNtsR9Q==',
      kr: 'sha512-xtsAgK4S4MjPllHRSAFaMiB7xnFb8Nlhx47uPaD/qvyTP5WgRICNawZmwGzLVshCyA/QmydSVzA9kWF8otycpQ==',
      tc: 'sha512-bX+7aXbMU9IyncD2v00P4E+aciwQl2e9F9qmHp3H3By+hQVh6bwa4rR2RD0QP/Vtt+9mwgjEPzsnEKb2oyIxog==',
      sc: 'sha512-nIK2HyNGcUi2TGwIfrk2MItkh0O3Y5+TI8iPfPSzoNY6uyXYfQ9qqch8czk3aa1VhV4EU52uwCYCe1UDKJELpg==',
    }[key],
    blocks: key === 'jp' ? union(HAN, KANA) : key === 'kr' ? union(HAN, HANGUL) : HAN,
    numberedOnly: true,
    size: 88,
    why: 'Ideographs fill 0.91em of the em (hangul 0.93em). Noto Serif CJK sets them at 1.25x its own Latin capitals; at 88% they stand 0.80em, 1.24x Alegreya\'s capitals, so a name mixing both reads as one line instead of the Han looking a size up.',
  })),
];

// --- Main -------------------------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf('--from');
  const from = fromIndex >= 0 ? resolve(args[fromIndex + 1] ?? '') : undefined;
  const all = [ALEGREYA, ...WORLD_FACES];
  try {
    build(from ? locate(all, from) : pack(all));
  } finally {
    for (const dir of unpacked) rmSync(dir, { recursive: true, force: true });
  }
}

/** Unpack directories this run created, removed when it ends. */
const unpacked = [];

function build(roots) {
  const latin = readVerticalMetrics(readFileSync(LATIN_ROMAN));
  for (const key of Object.keys(ALEGREYA_EXPECTED)) {
    if (latin[key] !== ALEGREYA_EXPECTED[key]) throw new Error(`Alegreya ${key} is ${latin[key]}, expected ${ALEGREYA_EXPECTED[key]}`);
  }
  const metrics = { ascent: latin.ascent / latin.unitsPerEm, descent: latin.descent / latin.unitsPerEm };

  const latinRange = spans(readFileSync(join(UI_SRC, 'kit.css'), 'utf8').match(/alegreya-roman-latin\.woff2[^}]*unicode-range:\s*([^;]+);/)?.[1]);
  if (!latinRange.length) throw new Error('kit.css no longer declares the Alegreya Latin range');

  const report = [];
  const alegreyaFaces = buildAlegreya(roots.get(ALEGREYA.name), latinRange, report);
  rmSync(WORLD, { recursive: true, force: true });
  const world = WORLD_FACES.map((pkg) => buildWorld(pkg, roots.get(pkg.name), metrics, report));

  writeFileSync(CSS_OUT, css({ latinRange, alegreyaFaces, world, metrics }));
  report.push(`fonts.css ${statSync(CSS_OUT).size} bytes`);
  console.log(report.join('\n'));
}

/** Finds each pinned package under `dir`, as a pinned tarball (verified, then unpacked) or an extracted folder. */
function locate(packages, dir) {
  const roots = new Map();
  let work;
  for (const pkg of packages) {
    const tarball = join(dir, tarballName(pkg));
    if (existsSync(tarball)) {
      if (!work) unpacked.push((work = mkdtempSync(join(tmpdir(), 'chatdom-fonts-unpack-'))));
      roots.set(pkg.name, unpack(pkg, tarball, work));
      continue;
    }
    const folder = readdirSync(dir).map((entry) => join(dir, entry, 'package')).find((root) => {
      const manifest = join(root, 'package.json');
      if (!existsSync(manifest)) return false;
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
      return name === pkg.name && version === pkg.version;
    });
    if (!folder) throw new Error(`${pkg.name}@${pkg.version} is not in ${dir}`);
    console.warn(`${pkg.name}@${pkg.version}: extracted folder, tarball integrity not checked`);
    roots.set(pkg.name, folder);
  }
  return roots;
}

/** Fetches every pinned package with `npm pack` (no scripts run) into a fresh /tmp dir. */
function pack(packages) {
  const dir = mkdtempSync(join(tmpdir(), 'chatdom-fonts-pack-'));
  for (const pkg of packages) {
    console.log(`npm pack ${pkg.name}@${pkg.version}`);
    execFileSync('npm', ['pack', `${pkg.name}@${pkg.version}`, '--ignore-scripts', '--silent', '--pack-destination', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  console.log(`tarballs kept in ${dir} (reuse with --from)`);
  return locate(packages, dir);
}

function tarballName(pkg) {
  return `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
}

function unpack(pkg, tarball, work) {
  const digest = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  if (digest !== pkg.integrity) throw new Error(`${basename(tarball)} does not match the pinned integrity`);
  const target = mkdtempSync(join(work, 'pkg-'));
  // Only what we read: the manifest, the licence, the CSS and the 400 normal (or variable) woff2 files.
  const files = pkg === ALEGREYA ? 'package/files/*-wght-*.woff2' : 'package/files/*-400-normal.woff2';
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--no-same-owner', '--no-same-permissions', '--wildcards',
    'package/package.json', 'package/LICENSE', 'package/*.css', files]);
  return join(target, 'package');
}

// --- Alegreya ---------------------------------------------------------------------------------------------------

function buildAlegreya(root, latinRange, report) {
  const faces = [];
  let bytes = 0;
  for (const [style, sheet] of [['normal', 'index.css'], ['italic', 'wght-italic.css']]) {
    const declared = parseFaces(readFileSync(join(root, sheet), 'utf8'));
    for (const subset of ALEGREYA.subsets) {
      const file = `alegreya-${subset}-wght-${style}.woff2`;
      const face = declared.find((f) => f.file === file && f.style === style);
      if (!face) throw new Error(`Alegreya ${subset} ${style} is missing from ${sheet}`);
      // The Latin file already answers for anything in its own range, so the extra subsets never compete with it.
      const range = subtract(face.range, latinRange);
      if (!range.length) continue;
      copyFileSync(join(root, 'files', file), join(FONTS, file));
      bytes += statSync(join(FONTS, file)).size;
      faces.push({ style, file, range });
    }
  }
  copyLicence(root, join(FONTS, ALEGREYA.licence));
  report.push(`Alegreya extra subsets: ${faces.length} files, ${bytes} bytes`);
  return faces;
}

// --- World faces ------------------------------------------------------------------------------------------------

function buildWorld(pkg, root, alegreya, report) {
  const out = join(WORLD, pkg.dir);
  mkdirSync(out, { recursive: true });
  const faces = [];
  let bytes = 0;
  let dropped = 0;
  for (const face of parseFaces(readFileSync(join(root, '400.css'), 'utf8'))) {
    if (face.style !== 'normal' || face.weight !== '400') continue;
    if (pkg.numberedOnly && !/-\d+-400-normal\.woff2$/.test(face.file)) continue;
    const range = intersect(face.range, pkg.blocks);
    if (!range.length) { dropped += 1; continue; }
    copyFileSync(join(root, 'files', face.file), join(out, face.file));
    bytes += statSync(join(out, face.file)).size;
    faces.push({ file: face.file, range });
  }
  if (!faces.length) throw new Error(`${pkg.name} left no faces`);
  faces.sort((a, b) => a.range[0][0] - b.range[0][0]);
  copyLicence(root, join(out, 'OFL.txt'));

  const scale = pkg.size / 100;
  const overrides = {
    size: `${pkg.size}%`,
    ascent: percent(alegreya.ascent / scale),
    descent: percent(alegreya.descent / scale),
  };
  report.push(`${pkg.family}: ${faces.length} files (${dropped} dropped as out of script), ${bytes} bytes, size-adjust ${overrides.size}, ascent ${overrides.ascent}, descent ${overrides.descent}`);
  return { pkg, faces, overrides };
}

function copyLicence(root, target) {
  const text = readFileSync(join(root, 'LICENSE'), 'utf8');
  if (!text.includes('SIL OPEN FONT LICENSE Version 1.1')) throw new Error(`${root}/LICENSE is not the OFL 1.1`);
  writeFileSync(target, text);
}

// --- CSS --------------------------------------------------------------------------------------------------------

const DEFAULT_ORDER = ['Chatdom Arabic', 'Chatdom Hebrew', 'Chatdom Devanagari', 'Chatdom Thai', 'Chatdom JP', 'Chatdom KR', 'Chatdom TC', 'Chatdom SC'];
const FALLBACK = "Georgia, 'Times New Roman', serif";

function stack(first) {
  const cjk = ['Chatdom JP', 'Chatdom KR', 'Chatdom TC', 'Chatdom SC'];
  const order = DEFAULT_ORDER.filter((family) => !cjk.includes(family)).concat([first, ...cjk.filter((family) => family !== first)].filter(Boolean));
  return `Alegreya, ${order.map((family) => `'${family}'`).join(', ')}, ${FALLBACK}`;
}

function css({ latinRange, alegreyaFaces, world, metrics }) {
  const rel = (file) => `./${relative(UI_SRC, file).split('\\').join('/')}`;
  const lines = [];
  lines.push(`/* Name faces: every script a Twitch display name may use, from our own origin.
   Generated by packages/ui/src/fonts/build.mjs from pinned fontsource packages; edit the script, not this file.
   Each world face covers only its own script's Unicode blocks, so a page showing only Latin text never fetches a
   non-Latin file. Credits and licences: THIRD_PARTY.md, and the OFL beside each folder of files. */

/* Latin, exactly as kit.css declares it, so this sheet stands on its own. */
@font-face { font-family: 'IM Fell English'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/im-fell-english-regular.woff2') format('woff2'); }
@font-face { font-family: 'IM Fell English'; font-style: italic; font-weight: 400; font-display: swap; src: url('./fonts/im-fell-english-italic.woff2') format('woff2'); }
@font-face { font-family: 'IM Fell English SC'; font-style: normal; font-weight: 400; font-display: swap; src: url('./fonts/im-fell-english-sc.woff2') format('woff2'); }
@font-face { font-family: 'Alegreya'; font-style: normal; font-weight: 400 900; font-display: swap; src: url('./fonts/alegreya-roman-latin.woff2') format('woff2');
  unicode-range: ${formatRange(latinRange, ', ')}; }
@font-face { font-family: 'Alegreya'; font-style: italic; font-weight: 400 900; font-display: swap; src: url('./fonts/alegreya-italic-latin.woff2') format('woff2');
  unicode-range: ${formatRange(latinRange, ', ')}; }

/* Alegreya's other alphabets (${ALEGREYA.name}@${ALEGREYA.version}): Latin Extended, Cyrillic, Greek and Vietnamese.
   Their ranges leave out everything the Latin file already covers, so declaration order never matters. */`);
  for (const face of alegreyaFaces) {
    lines.push(`@font-face { font-family: 'Alegreya'; font-style: ${face.style}; font-weight: 400 900; font-display: swap; src: url('${rel(join(FONTS, face.file))}') format('woff2'); unicode-range: ${formatRange(face.range)}; }`);
  }
  lines.push(`
/* World faces, 400 normal (bold and italic names are synthesised). Every one carries Alegreya's own vertical metrics
   (ascent ${percent(metrics.ascent)}, descent ${percent(metrics.descent)}, no line gap, read from alegreya-roman-latin.woff2) divided by its
   size-adjust, because size-adjust scales the overrides too: the line box is the same whichever face draws a name,
   so nothing shifts when a face swaps in. Marks and descenders may ink outside that box; .cd-name's leading and
   .cd-name-line's clipping leave them visible. */`);
  for (const { pkg, faces, overrides } of world) {
    lines.push(`\n/* ${pkg.family}: ${pkg.name}@${pkg.version}. size-adjust ${overrides.size}: ${pkg.why} */`);
    for (const face of faces) {
      lines.push(`@font-face { font-family: '${pkg.family}'; font-style: normal; font-weight: 400; font-display: swap; src: url('${rel(join(WORLD, pkg.dir, face.file))}') format('woff2'); size-adjust: ${overrides.size}; ascent-override: ${overrides.ascent}; descent-override: ${overrides.descent}; line-gap-override: 0%; unicode-range: ${formatRange(face.range)}; }`);
    }
  }
  lines.push(`
/* The name face. Alegreya first (Latin, Cyrillic, Greek, Vietnamese), then one face per script. The CJK families
   share Han, so the element's lang picks whose glyph forms win; names.ts sets lang from the name and the channel. */
:root { --cd-face-name: ${stack()}; }
:lang(zh), :lang(zh-TW), :lang(zh-HK), :lang(zh-MO) { --cd-face-name: ${stack('Chatdom TC')}; }
:lang(zh-CN), :lang(zh-SG), :lang(zh-MY) { --cd-face-name: ${stack('Chatdom SC')}; }
:lang(zh-Hant) { --cd-face-name: ${stack('Chatdom TC')}; }
:lang(zh-Hans) { --cd-face-name: ${stack('Chatdom SC')}; }
:lang(ja) { --cd-face-name: ${stack('Chatdom JP')}; }
:lang(ko) { --cd-face-name: ${stack('Chatdom KR')}; }

/* A name. isolate keeps a right-to-left name from reordering the words around it; anywhere lets a long unbroken
   name wrap rather than push its box wider. 1.6 leaves about .12em above and below Alegreya's own box, room for
   Thai stacked vowels and tone marks, Devanagari marks and Arabic descenders without touching the next line. */
.cd-name { font-family: var(--cd-face-name); unicode-bidi: isolate; overflow-wrap: anywhere; line-height: 1.6; }

/* One line ending in an ellipsis. overflow: hidden would clip marks that rise above or hang below the line box,
   so the fallback pads the box by .3em top and bottom and takes the same back with negative margins. Where
   overflow: clip is supported (Chrome 90, Firefox 81, Safari 16) only the inline axis is clipped: clip, unlike
   hidden, does not force the other axis to auto, so overflow-y stays visible and nothing is cut vertically, and
   text-overflow still draws its ellipsis because the inline axis is no longer visible. */
.cd-name-line { display: block; max-width: 100%; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; padding-block: .3em; margin-block: -.3em; }
@supports (overflow-x: clip) {
  .cd-name-line { overflow-x: clip; overflow-y: visible; padding-block: 0; margin-block: 0; }
}
`);
  return lines.join('\n');
}

// --- Unicode ranges ---------------------------------------------------------------------------------------------

/** Parses `0600-06FF FB50-FDFF` or a CSS `unicode-range` value (with `U+`, commas and `?` wildcards). */
function spans(text = '') {
  const out = [];
  for (const raw of text.split(/[\s,]+/)) {
    const token = raw.replace(/^U\+/i, '');
    if (!token) continue;
    if (token.includes('?')) {
      out.push([parseInt(token.replace(/\?/g, '0'), 16), parseInt(token.replace(/\?/g, 'F'), 16)]);
      continue;
    }
    const [lo, hi = lo] = token.split('-');
    out.push([parseInt(lo, 16), parseInt(hi, 16)]);
  }
  for (const [lo, hi] of out) if (!(lo <= hi) || hi > 0x10ffff) throw new Error(`bad range in ${text}`);
  return merge(out);
}

function merge(list) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

function union(a, b) {
  return merge([...a, ...b]);
}

function intersect(a, b) {
  const out = [];
  for (const [alo, ahi] of a) for (const [blo, bhi] of b) {
    const lo = Math.max(alo, blo);
    const hi = Math.min(ahi, bhi);
    if (lo <= hi) out.push([lo, hi]);
  }
  return merge(out);
}

function subtract(a, b) {
  let rest = a.map(([lo, hi]) => [lo, hi]);
  for (const [blo, bhi] of b) {
    rest = rest.flatMap(([lo, hi]) => {
      if (bhi < lo || blo > hi) return [[lo, hi]];
      const parts = [];
      if (lo < blo) parts.push([lo, blo - 1]);
      if (hi > bhi) parts.push([bhi + 1, hi]);
      return parts;
    });
  }
  return merge(rest);
}

function formatRange(list, separator = ',') {
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  return list.map(([lo, hi]) => (lo === hi ? `U+${hex(lo)}` : `U+${hex(lo)}-${hex(hi)}`)).join(separator);
}

function percent(fraction) {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

/** Reads fontsource's @font-face blocks: file name, style, weight and range. */
function parseFaces(text) {
  return [...text.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => {
    const value = (key) => body.match(new RegExp(`${key}:\\s*([^;]+);`))?.[1].trim();
    const file = body.match(/url\(\.\/files\/([\w.-]+\.woff2)\)/)?.[1];
    if (!file) throw new Error(`face without a woff2 file: ${body}`);
    return { file, style: value('font-style'), weight: value('font-weight'), range: spans(value('unicode-range') ?? '') };
  });
}

// --- WOFF2 vertical metrics -------------------------------------------------------------------------------------

/**
 * Reads units per em and the vertical metrics a browser uses (OS/2 typo when USE_TYPO_METRICS is set, hhea
 * otherwise) from a WOFF2 file. head, hhea and OS/2 are never transformed in WOFF2, so this only walks the table
 * directory and decompresses the stream.
 */
function readVerticalMetrics(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buffer.readUInt16BE(12);
  const compressedLength = buffer.readUInt32BE(20);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = buffer[offset++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  const known = { 1: 'head', 2: 'hhea', 6: 'OS/2', 10: 'glyf', 11: 'loca' };
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buffer[offset++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag = known[index] ?? `#${index}`;
    if (index === 63) { tag = buffer.toString('latin1', offset, offset + 4); offset += 4; }
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag, length });
  }
  const stream = brotliDecompressSync(buffer.subarray(offset, offset + compressedLength));
  const at = {};
  let cursor = 0;
  for (const table of tables) { at[table.tag] = cursor; cursor += table.length; }
  const unitsPerEm = stream.readUInt16BE(at.head + 18);
  const hhea = { ascent: stream.readInt16BE(at.hhea + 4), descent: -stream.readInt16BE(at.hhea + 6), lineGap: stream.readInt16BE(at.hhea + 8) };
  const os2 = at['OS/2'];
  const useTypo = (stream.readUInt16BE(os2 + 62) & (1 << 7)) !== 0;
  const typo = { ascent: stream.readInt16BE(os2 + 68), descent: -stream.readInt16BE(os2 + 70), lineGap: stream.readInt16BE(os2 + 72) };
  return { unitsPerEm, ...(useTypo ? typo : hhea) };
}

main();
