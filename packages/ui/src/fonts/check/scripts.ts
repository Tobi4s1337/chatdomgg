// Lays out one name per script with the kit's own helpers, then measures what the check asserts: which faces
// loaded, the line box of each script against Alegreya's, and how far marks ink above and below the line.
import '../../fonts.css';
import { applyName, loadNameFaces, NAME_FAMILIES, nameFont } from '../../names';

/** True when every visible character of `text` has a loaded face, in one of `families`, whose range covers it. */
function facesLoaded(text: string, families: readonly string[]): boolean {
  const faces = [...document.fonts].filter((face) => families.includes(face.family.replace(/["']/g, '')) && face.status === 'loaded');
  const covers = (face: FontFace, point: number) => face.unicodeRange.split(',').some((token) => {
    const [lo, hi = lo] = token.trim().replace(/^U\+/i, '').split('-');
    return point >= parseInt(lo!, 16) && point <= parseInt(hi!, 16);
  });
  return [...text.replace(/\s/g, '')].every((char) => faces.some((face) => covers(face, char.codePointAt(0)!)));
}

/** Names as a channel would hand them over, with the channel's broadcast language as the hint. */
const NAMES: ReadonlyArray<{ script: string; text: string; hint?: string; family: string }> = [
  { script: 'Latin', text: 'Wanderer', family: 'Alegreya' },
  { script: 'Cyrillic', text: 'Иван Грозный', hint: 'ru', family: 'Alegreya' },
  { script: 'Greek', text: 'Αλέξανδρος', hint: 'el', family: 'Alegreya' },
  { script: 'Arabic', text: 'محمد الجميل', hint: 'ar', family: 'Chatdom Arabic' },
  { script: 'Hebrew', text: 'שָׁלוֹם דוד', hint: 'he', family: 'Chatdom Hebrew' },
  { script: 'Devanagari', text: 'अर्जुन कृष्ण', hint: 'hi', family: 'Chatdom Devanagari' },
  { script: 'Thai', text: 'สมชาย ปั้น', hint: 'th', family: 'Chatdom Thai' },
  { script: 'Chinese (simplified)', text: '龙王小明', hint: 'zh-cn', family: 'Chatdom SC' },
  { script: 'Chinese (traditional)', text: '龍王小明', hint: 'zh-tw', family: 'Chatdom TC' },
  { script: 'Japanese', text: 'さくら東京', hint: 'ja', family: 'Chatdom JP' },
  { script: 'Korean', text: '김하늘', hint: 'ko', family: 'Chatdom KR' },
];

/**
 * The tallest and deepest stacks we expect in names, drawn only on the canvas. `fit` marks the ones that must stay
 * inside .cd-name's leading; fully vocalised Arabic (kasra under a final yeh hangs about .63em) is only reported:
 * it may reach toward the next line, which is acceptable because nothing clips it.
 */
const EXTREMES = [
  { script: 'Thai', text: 'ปั้ป๋ฟุ้ฬี่ญู ฎุฐู', fit: true },
  { script: 'Devanagari', text: 'र्कीँ ह्रृ द्धु', fit: true },
  { script: 'Arabic', text: 'يسي جميل ﷲ نجيب', fit: true },
  { script: 'Arabic, vocalised', text: 'يٌّ جـيـمُ ضِ بِيِ نِّ', fit: false },
  { script: 'Hebrew', text: 'שָׁלֹום קָ', fit: true },
  { script: 'Vietnamese', text: 'Ệ Ỗ ữ', fit: true },
];

const names = document.getElementById('names')!;
const lines = document.getElementById('lines')!;
for (const name of NAMES) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('span');
  label.textContent = name.script;
  const plain = document.createElement('span');
  applyName(plain, name.text, name.hint);
  const normal = document.createElement('div');
  applyName(normal, name.text, name.hint);
  normal.classList.add('normal');
  normal.dataset.script = name.script;
  const clipped = document.createElement('span');
  applyName(clipped, `${name.text} ${name.text}`, name.hint);
  clipped.classList.add('cd-name-line', 'narrow');
  row.append(label, plain, clipped);
  names.append(row);
  lines.append(normal);
}

type Box = { above: number; below: number };

/**
 * The line each world face makes on its own, beside Alegreya's. World faces never cover U+0020, so they are never a
 * line's primary font; a strut face with zero metrics, covering only the space, takes that place, so the line box
 * (line-height normal, 40px) is exactly the glyph face's ascent and descent. An empty inline-block marks the
 * baseline. A control face loads the same file without the overrides, so the check can tell the measurement works.
 */
async function faceBoxes() {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule);
  const src = (family: string, point: number) => rules.find((rule) => rule.style.getPropertyValue('font-family').replace(/["']/g, '') === family && rule.style.getPropertyValue('unicode-range').split(',').some((token) => {
    const [lo, hi = lo] = token.trim().replace(/^U\+/i, '').split('-');
    return point >= parseInt(lo!, 16) && point <= parseInt(hi!, 16);
  }))?.style;
  const latin = src('Alegreya', 0x57)!;
  document.fonts.add(await new FontFace('Strut Zero', latin.getPropertyValue('src'), { unicodeRange: 'U+20', ascentOverride: '0%', descentOverride: '0%', lineGapOverride: '0%' }).load());

  const host = document.createElement('div');
  document.body.append(host);
  const line = (family: string, text: string): Box => {
    const div = document.createElement('div');
    div.style.cssText = `font: 40px/normal 'Strut Zero', ${family}; white-space: nowrap`;
    const marker = document.createElement('span');
    marker.style.cssText = 'display: inline-block; width: 0; height: 0';
    div.append(text, marker);
    host.append(div);
    const box = div.getBoundingClientRect();
    const baseline = marker.getBoundingClientRect().top;
    return { above: (baseline - box.top) / 40, below: (box.bottom - baseline) / 40 };
  };

  const out: Array<{ family: string; box: Box; control?: Box }> = [{ family: 'Alegreya', box: line('Alegreya', 'Wanderer') }];
  for (const name of NAMES.filter((entry) => entry.family.startsWith('Chatdom '))) {
    const text = name.text.replace(/\s/g, '');
    const rule = src(name.family, text.codePointAt(0)!);
    let control: Box | undefined;
    if (rule) {
      const family = `Control ${name.family}`;
      document.fonts.add(await new FontFace(family, rule.getPropertyValue('src'), { unicodeRange: rule.getPropertyValue('unicode-range') }).load());
      control = line(`'${family}'`, text);
    }
    out.push({ family: name.family, box: line(`'${name.family}'`, text), ...(control ? { control } : {}) });
  }
  host.remove();
  return out;
}

async function measure() {
  await document.fonts.ready;
  const canvasNames = ['Ольга', 'Ωμέγα', 'فاطمة', 'אורי', 'सीता', 'มาลี', '黄河', '黃河', 'ゆき', '서울'];
  await loadNameFaces([...canvasNames, ...EXTREMES.map((e) => e.text)], { px: 20 });
  const context = (document.getElementById('canvas') as HTMLCanvasElement).getContext('2d')!;
  const ink = EXTREMES.map(({ script, text, fit }) => {
    context.font = nameFont(20, { text });
    const metrics = context.measureText(text);
    return { script, fit, above: metrics.actualBoundingBoxAscent / 20, below: metrics.actualBoundingBoxDescent / 20 };
  });
  context.font = nameFont(20, { text: canvasNames.join(' ') });
  context.fillText(canvasNames.join(' '), 4, 40);
  const lineBoxes = [...lines.children].map((element) => ({
    script: (element as HTMLElement).dataset.script!,
    height: element.getBoundingClientRect().height,
  }));
  const loaded = NAMES.map((name) => ({ script: name.script, family: name.family, ok: facesLoaded(name.text, [name.family]) }));
  const canvasLoaded = canvasNames.map((text) => ({ text, ok: facesLoaded(text, NAME_FAMILIES) }));
  const faces = await faceBoxes();
  const clip = getComputedStyle(names.querySelector('.cd-name-line')!);
  const result = { faces, lineBoxes, loaded, canvasLoaded, ink, clip: { x: clip.overflowX, y: clip.overflowY, textOverflow: clip.textOverflow }, lineHeight: parseFloat(getComputedStyle(names.querySelector('.cd-name')!).lineHeight) / 18 };
  (window as unknown as { nameCheck: unknown }).nameCheck = result;
}

void measure().catch((error) => {
  (window as unknown as { nameCheck: unknown }).nameCheck = { error: String(error) };
});
