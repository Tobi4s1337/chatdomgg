// The kit's names bench: Twitch names in every script the kit serves, in each piece that shows a name: the sign-in
// seal, the footer's signed-in line, a citizen slip, and drawn on a canvas the way the Atlas and the world draw
// names. Each name is a typed bench value; no session, feed or save stands behind any of them.
import { For, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { Icon, SignInSeal, TwitchMark, WatchOnTwitch } from '../index';
import { loadNameFaces, nameDirection, nameFont, nameLang, applyName } from '../names';
import { createSignedInSeal, createSiteFooter, type Session } from '../site/index';
import type { IconName } from '../site/pieces.mjs';
import '../kit.css';
import '../fonts.css';
import '../site/site.css';
import './bench.css';
import './names.css';

export interface BenchName { readonly script: string; readonly name: string; readonly hint?: string; readonly home: string }

export const WORLD_NAMES: readonly BenchName[] = [
  { script: 'Cyrillic', name: 'Снежная_Лиса', home: 'Lantern Row' },
  { script: 'Greek', name: 'Αθηνά_Νυχτερινή', home: 'Mill Lane' },
  { script: 'Arabic', name: 'صقر_الليل', home: 'Harbour Steps' },
  { script: 'Hebrew', name: 'אריה_הזהב', home: 'Orchard Walk' },
  { script: 'Devanagari', name: 'रात_का_राजा', home: 'Bell Street' },
  { script: 'Thai', name: 'เจ้าหญิงแห่งทุ่งดอกไม้สีทอง', home: 'Willow Bank' },
  { script: 'Chinese, simplified', name: '星河漫步者', hint: 'zh-cn', home: 'Kiln Yard' },
  { script: 'Chinese, traditional', name: '龍貓愛吃飯', hint: 'zh-tw', home: 'Rope Walk' },
  { script: 'Japanese', name: 'さくらの騎士', home: 'Fox Hollow' },
  { script: 'Korean', name: '밤하늘별빛', home: 'Tanner’s Close' },
  { script: 'Vietnamese', name: 'Phượng_Hoàng', home: 'Ferry Lane' },
  { script: 'Arabic, long', name: 'أميرة_الصحراء_الذهبية_وقمر_الليل', home: 'Lantern Row' },
];
export const LATIN_NAMES: readonly BenchName[] = [
  { script: 'Latin', name: 'tobi4s_', home: 'Castle Hill' },
  { script: 'Latin', name: 'LanternKeeper', home: 'Lantern Row' },
  { script: 'Latin', name: 'Mira_Fernsby', home: 'Mill Lane' },
  { script: 'Latin', name: 'quietoak', home: 'Orchard Walk' },
  { script: 'Latin', name: 'TheLongestLurkerInWillowmere', home: 'Bell Street' },
  { script: 'Latin', name: 'pip_and_wren', home: 'Willow Bank' },
];

const session = (name: string): Extract<Session, { status: 'authenticated' }> => ({ status: 'authenticated', csrfToken: 'bench', resumeScope: 'bench', name });
const WILLOWMERE = { kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' };
const ICONS: readonly IconName[] = ['door', 'atlas', 'card', 'panel', 'home', 'search', 'watch', 'chat', 'live', 'crown', 'sign-out', 'external'];

/** Mounts a DOM piece from `@chatdom/ui/site` into a Solid host. */
function Piece(props: { make: () => HTMLElement; class?: string }) {
  let host: HTMLDivElement | undefined;
  onMount(() => host?.append(props.make()));
  return <div class={props.class} ref={el => { host = el; }} />;
}

function Slip(props: { entry: BenchName }) {
  let name: HTMLHeadingElement | undefined;
  onMount(() => { if (name) applyName(name, props.entry.name, props.entry.hint); });
  return <article class="nb-slip cd-slip" data-script={props.entry.script}>
    <span class="nb-slip-wax" aria-hidden="true" />
    <p class="cd-label nb-slip-kicker">Citizen of Willowmere</p>
    <h3 class="nb-slip-name" ref={el => { name = el; }} />
    <p class="nb-slip-home">A home on {props.entry.home}</p>
    <p class="nb-slip-script">{props.entry.script}</p>
  </article>;
}

/** Names drawn on parchment under channel shields, after their faces have arrived, the way the map draws them. */
function MapStrip(props: { names: readonly BenchName[]; onDrawn: () => void }) {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    const draw = () => {
      if (!canvas) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth, columns = width < 600 ? 2 : width < 1000 ? 4 : 6;
      const rows = Math.ceil(props.names.length / columns), cell = width / columns, rowHeight = 112;
      canvas.height = Math.round((rows * rowHeight + 16) * ratio);
      canvas.width = Math.round(width * ratio);
      canvas.style.height = `${rows * rowHeight + 16}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const paper = ctx.createLinearGradient(0, 0, 0, rows * rowHeight);
      paper.addColorStop(0, '#efe0bc'); paper.addColorStop(1, '#ddc79a');
      ctx.fillStyle = paper; ctx.fillRect(0, 0, width, rows * rowHeight + 16);
      props.names.forEach((entry, i) => {
        const x = cell * (i % columns) + cell / 2, y = Math.floor(i / columns) * rowHeight + 18;
        // A channel shield: brass rim, a wine field, a lit window.
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(17, 5); ctx.lineTo(17, 22); ctx.quadraticCurveTo(15, 38, 0, 46); ctx.quadraticCurveTo(-15, 38, -17, 22); ctx.lineTo(-17, 5); ctx.closePath();
        ctx.fillStyle = '#7a2f22'; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = '#a07c3c'; ctx.stroke();
        ctx.fillStyle = '#f5cf86'; ctx.fillRect(-4, 16, 8, 10);
        ctx.restore();
        const lang = nameLang(entry.name, entry.hint);
        ctx.font = nameFont(16, { text: entry.name, ...(lang ? { lang } : {}) });
        ctx.direction = nameDirection(entry.name);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        // The label fits its cell: long names are drawn smaller rather than run into their neighbours.
        const room = cell - 18, measured = ctx.measureText(entry.name).width;
        if (measured > room) ctx.font = nameFont(Math.max(11, Math.floor(16 * room / measured)), { text: entry.name, ...(lang ? { lang } : {}) });
        ctx.lineWidth = 3.2; ctx.strokeStyle = '#f6ead0'; ctx.lineJoin = 'round';
        ctx.strokeText(entry.name, x, y + 74);
        ctx.fillStyle = '#38261a';
        ctx.fillText(entry.name, x, y + 74);
      });
    };
    void loadNameFaces(props.names.map(entry => entry.name)).then(() => { draw(); props.onDrawn(); });
    let pending = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); });
  });
  return <canvas class="nb-map" ref={el => { canvas = el; }} role="img" aria-label={`Names on the map: ${props.names.map(entry => entry.name).join(', ')}`} />;
}

export function NamesBench(props: { names: readonly BenchName[]; title: string; lede: string }) {
  const [first] = props.names;
  const rtl = props.names.find(entry => nameDirection(entry.name) === 'rtl') ?? first!;
  let drawn = false, mounted = false;
  const ready = () => { if (drawn && mounted) void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }))); };
  onMount(() => { mounted = true; ready(); });
  return <div class="nb">
    <main class="nb-main">
      <header class="nb-head cd-plate">
        <p class="cd-label nb-eyebrow">Carved kit · names bench</p>
        <h1>{props.title}</h1>
        <p class="nb-lede">{props.lede}</p>
      </header>

      <section class="nb-section" aria-labelledby="nb-seals">
        <h2 id="nb-seals" class="nb-h2">The sign-in seal</h2>
        <div class="nb-seals">
          <SignInSeal />
          <Piece class="nb-seal-open" make={() => {
            const seal = createSignedInSeal(session(first!.name), WILLOWMERE, { size: 'header' });
            // The header seal with its card let down, as after a press of the wax.
            const wax = seal.querySelector<HTMLButtonElement>('.cd-signin-wax'), who = seal.querySelector<HTMLElement>('.cd-signin-who');
            if (wax && who) { who.hidden = false; wax.setAttribute('aria-expanded', 'true'); }
            return seal;
          }} />
          <For each={props.names}>{(entry, i) => <Piece class="nb-seal" make={() => createSignedInSeal(session(entry.name), i() === 0 ? WILLOWMERE : null, { way: () => null })} />}</For>
        </div>
        <div class="nb-marks">
          <TwitchMark label="Twitch" />
          <WatchOnTwitch login="tobi4s_" />
          <WatchOnTwitch login="tobi4s_" size="small" />
          <span class="nb-icons" aria-label="The kit's icons">
            <For each={ICONS}>{name => <span class="nb-icon" title={name}><Icon name={name} /></span>}</For>
          </span>
        </div>
      </section>

      <section class="nb-section" aria-labelledby="nb-slips">
        <h2 id="nb-slips" class="nb-h2">On a citizen slip</h2>
        <div class="nb-slips"><For each={props.names}>{entry => <Slip entry={entry} />}</For></div>
        <p class="nb-line cd-slip">
          <span ref={el => applyName(el, rtl.name, rtl.hint)} /> lit a window on {rtl.home} at dusk, three lanes from the castle.
        </p>
      </section>

      <section class="nb-section" aria-labelledby="nb-map">
        <h2 id="nb-map" class="nb-h2">Drawn on the map</h2>
        <MapStrip names={props.names} onDrawn={() => { drawn = true; ready(); }} />
      </section>
    </main>
    <Piece make={() => createSiteFooter({ session: session(rtl.name) })} />
  </div>;
}

if (document.getElementById('root') && location.pathname.endsWith('/names.html')) {
  render(() => <NamesBench names={WORLD_NAMES} title="Every name renders"
    lede="Twelve Twitch names in eleven scripts, in our own faces: seals, slips, the footer and a canvas." />, document.getElementById('root')!);
}
