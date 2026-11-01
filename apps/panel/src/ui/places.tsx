// The kingdom's shared places, as the panel may show them: the tavern's tables, the
// forge as a signpost, and the building everyone raises together. The panel watches
// and explains; seats are taken, pieces forged and stones laid inside the kingdom.
import { For, Show, type JSX } from 'solid-js';
import type { Coals, Entry, Forge, PanelSnapshot, Raising, Tavern, TavernTable } from '../model';
import { CoalArt, ForgeArt, LeaveGlyph, TableArt } from './art';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
/** Small numbers read as words in the kingdom's voice. */
export const say = (n: number) => WORDS[n] ?? String(n);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The real kingdom always lives on chatdom.gg. Mounted inside the web app for review, the same app serves the gate. */
const CHATDOM = 'https://chatdom.gg';
function gateHref(path: string): string {
  const inWebApp = /\/panel\/?$/.test(location.pathname);
  return new URL(path, inWebApp ? location.origin : CHATDOM).href;
}

/** The site a gate leads to, in the words the link uses ("chatdom.io"). */
const hostOf = (path: string) => new URL(gateHref(path)).host;

/** "Walk in": secondary, says it leaves Twitch, opens a new tab at the kingdom's own entry gate. */
export function WalkIn(props: { entry: Entry; kingdom: string }) {
  return <Show when={props.entry.kind === 'gate' ? props.entry : null}>{gate =>
    <p class="cp-walk">
      <a href={gateHref(gate().path)} target="_blank" rel="noopener noreferrer" aria-label={`Walk in to ${props.kingdom} on ${hostOf(gate().path)}. Opens a new tab outside Twitch.`}>
        <span>Walk in</span><LeaveGlyph />
      </a>
      <small>Leaves Twitch for {hostOf(gate().path)}, in a new tab</small>
    </p>}
  </Show>;
}

/** The communal meter: a carved groove, a brass fill and a notch for each storey. Never anyone's share. */
export function RaisingMeter(props: { raising: Raising; compact?: boolean }) {
  const percent = () => Math.round(props.raising.progress * 100);
  const stage = () => Math.min(props.raising.steps, Math.floor(props.raising.progress * props.raising.steps) + 1);
  const words = () => props.raising.progress >= 1
    ? `${props.raising.building} is raised`
    : `${props.raising.building}: raising the ${ORDINALS[stage() - 1] ?? say(stage())} storey of ${say(props.raising.steps)}`;
  return <div class="cp-raising" classList={{ compact: !!props.compact }}>
    <Show when={!props.compact}><p class="cp-label">Raised together</p></Show>
    <p class="cp-raising-words">{words()}</p>
    <div class="cp-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent()} aria-label={`${props.raising.building}, ${percent()}% raised`}>
      <i style={{ width: `${props.raising.progress * 100}%` }} />
      <For each={Array.from({ length: props.raising.steps - 1 }, (_, i) => (i + 1) / props.raising.steps)}>{at =>
        <b class="cp-notch" classList={{ passed: props.raising.progress >= at }} style={{ left: `${at * 100}%` }} />}
      </For>
    </div>
    <Show when={!props.compact}>
      <p class="cp-body"><span class="cp-next">Then:</span> {props.raising.next}</p>
      <p class="cp-fine">Raised by everyone here: being present, <span class="cp-command">!haul</span> and channel points given to the pool. Nobody’s share is counted.</p>
    </Show>
  </div>;
}

function TableRow(props: { table: TavernTable }) {
  const free = () => props.table.seats - props.table.seated.length;
  const seatsWords = () => free() === 0 ? 'Every seat taken' : `${capital(say(free()))} ${free() === 1 ? 'seat' : 'seats'} free`;
  return <li class="cp-table" classList={{ free: !props.table.game }}>
    <TableArt seats={props.table.seats} taken={props.table.seated.length} playing={!!props.table.game} />
    <div class="cp-table-words">
      <p class="cp-table-name">{props.table.name}<Show when={props.table.game}>{game => <span class="cp-table-game">{game()}</span>}</Show></p>
      <p class="cp-table-now">{props.table.now}</p>
      <Show when={props.table.seated.length > 0}>
        <p class="cp-table-seated"><span class="cp-names">{props.table.seated.join(' · ')}</span><span class="cp-seats-free">{seatsWords()}</span></p>
      </Show>
    </div>
  </li>;
}

export function TavernSheet(props: { snap: PanelSnapshot; empty: (reason: string) => JSX.Element }) {
  const tavern = () => props.snap.tavern.kind === 'supplied' ? props.snap.tavern as Extract<Tavern, { kind: 'supplied' }> : null;
  return <Show when={tavern()} fallback={props.empty((props.snap.tavern as { reason: string }).reason)}>{t =>
    <div class="cp-sheet">
      <div class="cp-plaque">
        <span class="cp-rivet" aria-hidden="true" /><span class="cp-rivet" aria-hidden="true" />
        <p class="cp-plaque-name">{t().place}</p>
        <p class="cp-plaque-street">{t().where}</p>
      </div>
      <ul class="cp-tables" aria-label="Tables">
        <For each={t().tables}>{table => <TableRow table={table} />}</For>
      </ul>
      <p class="cp-watching"><strong>Watching from the panel.</strong> {t().watching}</p>
      <WalkIn entry={props.snap.entry} kingdom={props.snap.kingdom?.name ?? 'the kingdom'} />
    </div>}
  </Show>;
}

function Scuttle(props: { coals: Coals }) {
  return <section class="cp-scuttle" aria-label="Your scuttle">
    <p class="cp-label">Your scuttle</p>
    <Show when={props.coals.kind === 'known' ? props.coals : null} fallback={<p class="cp-body muted">{(props.coals as { reason: string }).reason}</p>}>{coals =>
      <div class="cp-scuttle-row">
        <span class="cp-coals" role="img" aria-label={`${coals().held} of ${coals().cap} coals`}>
          <For each={Array.from({ length: coals().cap }, (_, i) => i < coals().held)}>{held => <CoalArt held={held} damp={coals().damp} />}</For>
        </span>
        <p class="cp-body">{coals().damp
          ? 'Your coals are damp. They will be dry next time.'
          : coals().held === 0 ? 'Your scuttle is empty.' : `You hold ${say(coals().held)} ${coals().held === 1 ? 'coal' : 'coals'} of ${say(coals().cap)}.`}</p>
      </div>}
    </Show>
  </section>;
}

export function ForgeSheet(props: { snap: PanelSnapshot; empty: (reason: string) => JSX.Element }) {
  const forge = () => props.snap.forge.kind === 'supplied' ? props.snap.forge as Extract<Forge, { kind: 'supplied' }> : null;
  const anvilWords = (f: Extract<Forge, { kind: 'supplied' }>) => f.fire === 'banked'
    ? `Banked until the stream is live. ${capital(say(f.anvils.total))} anvils stand cold.`
    : f.anvils.working === 0 ? `${capital(say(f.anvils.total))} anvils, all free.` : `${capital(say(f.anvils.working))} of ${say(f.anvils.total)} anvils at work.`;
  return <Show when={forge()} fallback={props.empty((props.snap.forge as { reason: string }).reason)}>{f =>
    <div class="cp-sheet">
      <figure class="cp-forge" classList={{ banked: f().fire === 'banked' }}>
        <ForgeArt burning={f().fire === 'burning'} total={f().anvils.total} working={f().anvils.working} />
        <figcaption><strong>{f().fire === 'burning' ? 'The forge is burning' : 'The forge is banked'}</strong><span>{anvilWords(f())}</span></figcaption>
      </figure>
      <Scuttle coals={f().coals} />
      <section aria-label="How the forge works">
        <p class="cp-label">How the forge works</p>
        <ul class="cp-rules">
          <li>Each night you are here, your hearth gives you a coal. You hold three at most.</li>
          <li>A piece takes one coal. Nothing buys more, and nobody can give you one.</li>
          <li>It burns only while the stream is live, one piece in the fire each.</li>
          <li>If the forge turns a piece away, only you are told why.</li>
        </ul>
      </section>
      <Show when={f().made.length > 0}>
        <section class="cp-history" aria-label="Made at the forge">
          <p class="cp-label">{f().fire === 'burning' ? 'Made tonight' : 'Made last night'}</p>
          <ul><For each={f().made}>{piece => <li><span>{piece.text}</span></li>}</For></ul>
        </section>
      </Show>
      <p class="cp-watching"><strong>Nothing is forged from the panel.</strong> The forge stands inside the kingdom.</p>
      <WalkIn entry={props.snap.entry} kingdom={props.snap.kingdom?.name ?? 'the kingdom'} />
    </div>}
  </Show>;
}
