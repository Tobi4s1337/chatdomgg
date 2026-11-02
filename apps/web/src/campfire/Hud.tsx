import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { DUSK_COURT, type CampfireFrame, type DuskCourtPlayerView } from '@chatdom/shared';
import { ASK_WORDS, CHOICE_WORDS, GALLERY_WORDS, ROLE_NAMES, RULES, RULES_WIN, callWords, cardWords, watchWords } from './copy';
import { Glyph } from './glyphs';
import type { FireFocus, FireHand } from './input';
import { PhasePlate, lanternGlyph, useRoomClock, useSessionState } from './plate';
import type { CampfireSession } from './session';

/*
 * The fire's carved HUD for whoever sits or stands at it: the phase on one plate with its clock, the circle as a row of
 * names with their lanterns, your own sealed card, and the one thing you can do now (ask for a round, tap a lantern,
 * vote, call the phase). It reads only the session: the public frame and your own view. Nothing here is staged.
 */

/** The circle in seat order: a name, its lantern and, once shown, its card. Tappable while a choice is open. */
export function CircleRow(props: { frame: CampfireFrame; seat: number | null; focus: FireFocus; onTap?: (seat: FireFocus) => void }) {
  const court = () => props.frame.court!;
  return <ol class="campfire-circle" aria-label="The circle">
    <For each={court().players}>{player => {
      const tappable = () => !!props.onTap;
      return <li class="campfire-chip cd-slip" classList={{ 'is-dark': player.lantern !== 'lit' || player.gone, 'is-you': player.seat === props.seat, 'is-focus': props.focus === player.seat, 'is-away': player.away }}>
        <Show when={tappable()} fallback={<ChipBody player={player} you={player.seat === props.seat} phase={court().phase} />}>
          <button type="button" class="campfire-chip-button cd-focus" onClick={() => props.onTap?.(player.seat)} aria-pressed={props.focus === player.seat}>
            <ChipBody player={player} you={player.seat === props.seat} phase={court().phase} />
          </button>
        </Show>
      </li>;
    }}</For>
  </ol>;
}

function ChipBody(props: { player: DuskCourtPlayerView; you: boolean; phase: string }) {
  const p = () => props.player;
  return <>
    <span class="campfire-chip-seat cd-label" aria-hidden="true">{p().seat}</span>
    <Glyph name={lanternGlyph(p())} class="campfire-chip-lantern" title={p().lantern === 'lit' ? 'Lantern lit' : p().lantern === 'snuffed' ? 'Lantern snuffed' : 'Sent away'} />
    <span class="campfire-chip-name">{p().name}{props.you ? ' (you)' : ''}</span>
    <Show when={p().role}><span class="campfire-chip-role cd-label"><Glyph name={p().role!} />{ROLE_NAMES[p().role!]}</span></Show>
    <Show when={p().embers > 0 && !p().gone}><span class="campfire-chip-embers" aria-label={`Gallery suspicion ${p().embers} of 3`}><For each={Array.from({ length: p().embers })}>{() => <Glyph name="ember" />}</For></span></Show>
    <Show when={props.phase === 'ballot' && p().voted}><span class="campfire-chip-voted cd-label">voted</span></Show>
    <Show when={p().away && !p().gone}><span class="campfire-chip-voted cd-label">away</span></Show>
  </>;
}

export function RulesCard(props: { onClose?: () => void }) {
  return <section class="campfire-rules cd-plate" aria-label="How Dusk Court is played">
    <header class="campfire-rules-head">
      <p class="cd-label">Dusk Court</p>
      <h2>Find the Wolf</h2>
      <Show when={props.onClose}><button type="button" class="campfire-close cd-focus" onClick={() => props.onClose?.()} aria-label="Close the rules">×</button></Show>
    </header>
    <ul>
      <For each={RULES}>{rule => <li><Glyph name={rule.mark} class="campfire-rules-mark" /><span><b>{rule.title}.</b> {rule.line}</span></li>}</For>
    </ul>
    <p class="campfire-rules-win">{RULES_WIN}</p>
    <p class="campfire-rules-small">{`${DUSK_COURT.minPlayers} to ${DUSK_COURT.maxPlayers} players on the logs. Chat on Twitch is the Gallery: it can point, never vote.`}</p>
  </section>;
}

export interface CampfireHudProps {
  readonly session: CampfireSession;
  readonly hand?: FireHand | null;
  /** Shown while you sit: standing up goes through the seat's own interaction. */
  readonly onStand?: () => void;
  readonly variant?: 'page' | 'walk';
}

export function CampfireHud(props: CampfireHudProps) {
  const state = useSessionState(props.session);
  const now = useRoomClock(() => props.session.now());
  const [focus, setFocus] = createSignal<FireFocus>(props.hand?.focus() ?? null);
  if (props.hand) onCleanup(props.hand.onFocus(setFocus));
  const [rules, setRules] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(noticeTimer));
  const tell = (words: string) => { setNotice(words); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => setNotice(null), 3_200); };
  const frame = () => state().frame, self = () => state().self, court = () => frame()?.court ?? null;
  const card = createMemo(() => { const s = self(); return s ? cardWords(frame(), s) : null; });
  const choice = () => self()?.choice ?? null;
  const busy = () => state().pending > 0 || !state().connected;
  const seated = () => self()?.seat !== null && self()?.seat !== undefined;
  const choose = (seat: FireFocus) => {
    if (seat === null) return;
    if (props.hand) { props.hand.tap(seat); return; }
    setFocus(seat);
    void props.session.choose(seat === 'rest' ? null : seat).then(ok => { if (!ok) tell('The fire did not take that. Try again.'); });
  };
  const ask = () => void props.session.ask().then(ok => { if (!ok) tell('The fire could not start a round just now.'); });
  const call = () => void props.session.call().then(ok => { if (!ok) tell('The fire did not take the call.'); });
  const showRules = () => rules() || court()?.phase === 'call';
  const gallery = () => !!frame()?.live && (court()?.phase === 'talk' || court()?.phase === 'ballot');

  return <div class="campfire-hud cd-kit" classList={{ 'is-walk': props.variant === 'walk' }} data-campfire-hud>
    <div class="campfire-hud-top">
      <PhasePlate frame={frame()} now={now()}>
        <Show when={watchWords(frame(), self())}><p class="campfire-plate-note">{watchWords(frame(), self())}</p></Show>
        <Show when={gallery()}><p class="campfire-plate-note"><Glyph name="gallery" /> {GALLERY_WORDS}</p></Show>
      </PhasePlate>
      <Show when={card()}>
        <section class="campfire-card cd-slip" aria-label="Your card, for you alone">
          <Glyph name={self()!.role!} class="campfire-card-mark" />
          <div>
            <p class="campfire-card-eyebrow cd-label">Your card · keep it to yourself</p>
            <h3>{card()!.title}</h3>
            <p>{card()!.line}</p>
            <For each={card()!.notes}>{note => <p class="campfire-card-note">{note}</p>}</For>
          </div>
        </section>
      </Show>
    </div>

    <Show when={showRules()}><RulesCard {...(rules() ? { onClose: () => setRules(false) } : {})} /></Show>

    <div class="campfire-hud-bottom">
      <Show when={notice()}><p class="campfire-notice cd-slip" role="status">{notice()}</p></Show>
      <Show when={!state().connected && state().frame}><p class="campfire-notice cd-slip" role="status">The fire has lost the kingdom for a moment. It will pick up where it was.</p></Show>
      <Show when={choice()}>
        <p class="campfire-choice-title"><b>{CHOICE_WORDS[choice()!.kind].title}</b> <span>{CHOICE_WORDS[choice()!.kind].hint}</span></p>
      </Show>
      <Show when={court()}>
        <CircleRow frame={frame()!} seat={self()?.seat ?? null} focus={focus()} {...(choice() ? { onTap: choose } : {})} />
      </Show>
      <div class="campfire-actions">
        <Show when={choice()}>
          <button type="button" class="campfire-button is-quiet cd-focus" classList={{ 'is-focus': focus() === 'rest', 'is-chosen': choice()!.chosen === null && focus() === 'rest' }} disabled={busy()} onClick={() => choose('rest')}>{CHOICE_WORDS[choice()!.kind].rest}</button>
        </Show>
        <Show when={!choice() && self()?.canCall}>
          <button type="button" class="campfire-button cd-focus" disabled={busy()} onClick={call}><Glyph name="magistrate" /> {callWords(court())}</button>
        </Show>
        <Show when={!choice() && self()?.canAsk && !self()?.canCall}>
          <button type="button" class="campfire-button cd-focus" disabled={busy()} onClick={ask}><Glyph name="lantern" /> {ASK_WORDS}</button>
        </Show>
        <button type="button" class="campfire-button is-quiet cd-focus" aria-expanded={showRules()} onClick={() => setRules(!rules())}>Rules</button>
        <Show when={seated() && props.onStand}>
          <button type="button" class="campfire-button is-quiet cd-focus" onClick={() => props.onStand?.()}>Stand up</button>
        </Show>
      </div>
      <Show when={seated() && props.hand}><p class="campfire-keys cd-label">{choice() ? '← → to move · Enter to tap · 1–9 a seat · E to stand' : 'Enter to ask · E to stand'}</p></Show>
    </div>
  </div>;
}
