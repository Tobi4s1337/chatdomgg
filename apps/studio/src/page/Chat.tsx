// The chat column: header, the Hype Train, the messages (latest that fit, bottom-anchored), the input and its buttons.
// Every metric is taken from the reference capture of the real page (see rig/replica-check.mjs).
import { For, Match, Show, Switch, createMemo, type JSX } from 'solid-js';
import { badgeUrl, emoteUrl, type Badge, type ChatItem, type Chatter, type Fragment, type HypeTrain, type PageState } from '../types';
import { displayName } from '../chat/roster';
import { readableColor } from './format';
import { Icon, OwnIcon } from './icons';

/** How many of the latest items stay in the DOM; more than ever fit in the column. */
const KEEP = 70;

function Badges(props: { badges: readonly Badge[] }): JSX.Element {
  return (
    <For each={props.badges}>{badge => (
      <span class="badge-slot"><img class="chat-badge" src={badgeUrl(badge)} alt="" draggable={false} /></span>
    )}</For>
  );
}

/** A mention reads `@DisplayName`. Twitch's chat CSS boxes it only when it names the viewer (white chip) or when the
 * viewer wrote it (grey chip); every other mention is plain text. */
function Fragments(props: { fragments: readonly Fragment[]; me: string; from?: string }): JSX.Element {
  const mine = () => (props.from ?? '').toLowerCase() === props.me.toLowerCase();
  return (
    <For each={props.fragments}>{fragment => (
      <Switch>
        <Match when={fragment.kind === 'text' && fragment}>{f => <span class="text-fragment">{f().text}</span>}</Match>
        <Match when={fragment.kind === 'emote' && fragment}>{f => (
          <span class="emote"><img class="chat-image" src={emoteUrl(f().id)} alt={f().code} draggable={false} /></span>
        )}</Match>
        <Match when={fragment.kind === 'mention' && fragment}>{f => (
          <span class={`mention-fragment${f().login.toLowerCase().replace(/^@/, '') === props.me.toLowerCase() ? ' mention-fragment--recipient' : mine() ? ' mention-fragment--sender' : ''}`}>@{displayName(f().login)}</span>
        )}</Match>
      </Switch>
    )}</For>
  );
}

/** Badges, the coloured name and the message, as one wrapping line of chat. */
function MessageBody(props: { from: Chatter; fragments: readonly Fragment[]; me: string }): JSX.Element {
  return (
    <div class="msg">
      <span class="username-container"><Badges badges={props.from.badges} /><span class="display-name" style={{ color: readableColor(props.from.color) }}>{props.from.display}</span></span>
      <span class="colon">: </span>
      <span class="message-body"><Fragments fragments={props.fragments} me={props.me} from={props.from.login} /></span>
    </div>
  );
}

const tierWord = (tier: 1 | 2 | 3) => `Tier ${tier}`;

function Line(props: { item: ChatItem; me: string; channel: string }): JSX.Element {
  const item = () => props.item;
  return (
    <Switch>
      <Match when={item().kind === 'message' && (item() as Extract<ChatItem, { kind: 'message' }>)}>{m => (
        <div class={`chat-line${m().highlight === 'first-time' ? ' chat-line--first' : ''}`}>
          <Show when={m().highlight === 'first-time'}>
            <div class="first-head"><OwnIcon name="sparkle" size={16} /><span>First-time chat</span></div>
          </Show>
          <Show when={m().reply}>{reply => (
            <div class="reply-head">
              <Icon name="reply" size={17} />
              <p class="reply-text">Replying to <span>@{reply().to.display}</span>: <span>{reply().text}</span></p>
            </div>
          )}</Show>
          <MessageBody from={m().from} fragments={m().fragments} me={props.me} />
        </div>
      )}</Match>
      <Match when={item().kind === 'sub' && (item() as Extract<ChatItem, { kind: 'sub' }>)}>{s => (
        <div class="notice">
          <div class="notice-head">
            <OwnIcon name="star-filled" size={20} class="notice-icon" />
            <p>
              <b>{s().from.display}</b>{s().prime ? ' subscribed with Prime.' : ` subscribed at ${tierWord(s().tier)}.`}
              <Show when={s().months > 1}>
                {` They've subscribed for `}<b>{s().months} months</b>
                {s().streak && s().streak! > 1 ? `, currently on a ${s().streak} month streak!` : '!'}
              </Show>
            </p>
          </div>
          <Show when={s().fragments?.length}>
            <div class="notice-message"><MessageBody from={s().from} fragments={s().fragments ?? []} me={props.me} /></div>
          </Show>
        </div>
      )}</Match>
      <Match when={item().kind === 'gift' && (item() as Extract<ChatItem, { kind: 'gift' }>)}>{g => (
        <div class="notice">
          <div class="notice-head">
            <Icon name="gift" size={20} class="notice-icon" />
            <p><b>{g().from.display}</b>{` is gifting `}<b>{g().count}</b>{` ${tierWord(g().tier)} Sub${g().count === 1 ? '' : 's'} to ${props.channel}'s community!`}</p>
          </div>
        </div>
      )}</Match>
      <Match when={item().kind === 'raid' && (item() as Extract<ChatItem, { kind: 'raid' }>)}>{r => (
        <div class="notice notice--raid">
          <div class="notice-head">
            <img class="raid-avatar" src={r().from.avatar} alt="" draggable={false} />
            <p><b>{r().from.display}</b>{' is raiding with a party of '}<b>{r().viewers.toLocaleString('en-US')}</b>.</p>
          </div>
        </div>
      )}</Match>
      <Match when={item().kind === 'announcement' && (item() as Extract<ChatItem, { kind: 'announcement' }>)}>{a => (
        <div class={`announcement announcement--${a().accent}`}>
          <div class="announcement-head"><OwnIcon name="megaphone" size={16} /><span>Announcement</span></div>
          <MessageBody from={a().from} fragments={a().fragments} me={props.me} />
        </div>
      )}</Match>
    </Switch>
  );
}

function HypeTrainBar(props: { train: HypeTrain }): JSX.Element {
  const pct = () => Math.round(Math.min(1, Math.max(0, props.train.progress)) * 100);
  const left = () => { const s = Math.max(0, Math.floor(props.train.expiresIn)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return (
    <div class="hype-train">
      <div class="hype-train__row">
        <div class="hype-train__level"><span class="hype-train__lvl">LVL</span><span class="hype-train__num">{props.train.level}</span></div>
        <div class="hype-train__text">
          <p class="hype-train__title"><OwnIcon name="train" size={16} /> Hype Train</p>
          <p class="hype-train__sub">{left()} left · Level {props.train.level}</p>
        </div>
        <div class="hype-train__pct">{pct()}%</div>
      </div>
      <div class="hype-train__bar"><div class="hype-train__fill" style={{ width: `${pct()}%` }} /></div>
    </div>
  );
}

export function ChatColumn(props: { state: PageState; listRef: (el: HTMLDivElement) => void; scrollRef: (el: HTMLDivElement) => void }): JSX.Element {
  const s = () => props.state;
  const byId = createMemo(() => new Map(s().chat.map(item => [item.id, item])));
  const ids = createMemo(() => s().chat.slice(-KEEP).map(item => item.id), undefined, { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) });
  const me = () => s().me.display;
  return (
    <div class={`chat-column${s().theatre ? ' chat-column--theatre' : ''}`}>
      <div class="chat-header">
        <span class="icon-button chat-header__collapse"><Icon name="collapse-right" size={20} /></span>
        <h4 class="chat-header__title">Stream Chat</h4>
        <span class="icon-button chat-header__community"><Icon name="community" size={20} /></span>
      </div>
      <div class="chat-room">
        <div class="chat-scroller" ref={props.scrollRef}>
          <div class="chat-list" ref={props.listRef}>
            <For each={ids()}>{id => <Line item={byId().get(id)!} me={me()} channel={s().channel.display} />}</For>
          </div>
          <Show when={s().hypeTrain}>{train => <div class="hype-train-dock"><HypeTrainBar train={train()} /></div>}</Show>
        </div>
        <div class="chat-input">
          <div class={`chat-input__box${s().composing ? ' chat-input__box--focus' : ''}`}>
            <Show when={s().composing} fallback={<p class="chat-input__placeholder">Send a message</p>}>
              <p class="chat-input__text">{s().composing}<span class="caret" /></p>
            </Show>
            <span class="icon-button chat-input__bits"><Icon name="bits" size={20} /></span>
            <span class="icon-button chat-input__emote"><Icon name="emote" size={20} /></span>
          </div>
          <div class="chat-input__buttons">
            <span class="points-summary">
              <Icon name="bits" size={20} fill="#bf94ff" />
              <span class="points-summary__bits">0</span>
              <Icon name="points" size={20} fill="#bf94ff" />
              <span class="points-summary__points">1.2K</span>
            </span>
            <span class="chat-input__right">
              <span class="icon-button"><Icon name="settings" size={20} /></span>
              <span class="chat-button">Chat</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
