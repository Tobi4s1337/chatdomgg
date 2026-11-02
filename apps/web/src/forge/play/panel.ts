import '@chatdom/ui/kit.css';
import './panel.css';
import './queue.css';
import { FORGE_CHAT_LIMITS, ForgeChatRequestIdSchema, ForgeChatWishRequestSchema, type ForgeChatStatusReply, type ForgeChatWish } from '@chatdom/shared';
import { browserForgeTransport, ForgeTransportError, type ForgeTransport } from './transport';
import { forgeQueueCopy, forgeQueueMakers, forgeQueueMoreLine, watchForgeQueue, type ForgeQueueRead } from './queue';
import type { ForgeQueueView } from '@chatdom/shared';
import { KingdomIdSchema } from '@chatdom/shared';

export interface ForgeHost {
  readonly root: HTMLElement;
  readonly kingdomId: string;
  releasePointer(): void;
  restorePointer(): void;
  onClosed(): void;
}
export interface ForgeHandle { readonly isOpen: () => boolean; close(): void; dispose(): void }
export const FORGE_HUD_ENTRY = { id: 'forge', label: 'The Forge' } as const;

const descriptions: Record<ForgeChatWish['status'], [string, string]> = {
  sending: ['Sending your wish', 'Waiting for Twitch to answer.'],
  unknown: ['Still checking', 'We cannot yet tell whether Twitch sent your message. Please do not send it again.'],
  'not-sent': ['Not sent', 'Your words are still here.'],
  sent: ['Sent to chat', 'Your message reached Twitch. The Forge has not finished making it.'],
  working: ['At the Forge', 'Your wish is being worked on. Watch the Forge in the kingdom.'],
  delivered: ['Made in the kingdom', 'Your piece has been placed.'],
  held: ['Your wish is on hold', 'This wish is being held privately.'],
  refused: ['This wish could not be made', 'This answer is private to you.'],
  cold: ['The Forge is resting', 'This wish could not be made now.'],
  canceled: ['Wish closed', 'This wish could not be completed.'],
};
const active = (wish: ForgeChatWish | null) => wish && ['sending', 'unknown', 'sent', 'working'].includes(wish.status);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

/**
 * The anvil's line inside the panel: one sentence for everyone, and the makers' names in order for the broadcaster.
 * It repaints in place (never through the panel's full render), so a poll cannot disturb a wish being typed, and
 * it only touches the page when what it says has changed.
 */
function queueSlot() {
  const slot = el('div', 'forge-queue');
  // One live line that stays in place, so a change of place is announced; the names list is redrawn beside it.
  const line = el('div', 'forge-queue-line'), ember = el('i', 'forge-queue-ember'), words = el('span');
  ember.setAttribute('aria-hidden', 'true'); line.setAttribute('aria-live', 'polite'); line.append(ember, words);
  const list = el('div', 'forge-queue-makers'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'The line at the anvil, by name');
  let said = '', named = '';
  const paint = (view: ForgeQueueView | null) => {
    const copy = forgeQueueCopy(view), makers = forgeQueueMakers(view);
    const nextSaid = JSON.stringify(copy), nextNamed = JSON.stringify(makers);
    if (nextSaid !== said) {
      said = nextSaid;
      if (copy) { words.textContent = copy.line; line.dataset.tone = copy.tone; line.toggleAttribute('data-yours', copy.yours); }
      if (copy && line.parentNode !== slot) slot.prepend(line); else if (!copy) line.remove();
    }
    if (nextNamed === named) return;
    named = nextNamed;
    if (!makers) { list.remove(); return; }
    const rows = el('ol', 'forge-queue-rows');
    for (const row of makers.rows) {
      const item = el('li', 'forge-queue-row'); item.dataset.state = row.state;
      const mark = el('span', 'forge-queue-place', row.state === 'forging' ? '' : String(row.position)); mark.setAttribute('aria-hidden', 'true');
      item.append(mark, el('span', 'forge-queue-name', row.name), el('span', 'forge-queue-state', row.label)); rows.append(item);
    }
    list.replaceChildren(el('p', 'forge-wish-kicker', 'THE LINE'), rows);
    const more = forgeQueueMoreLine(makers.more); if (more) list.append(el('p', 'forge-queue-more', more));
    list.append(el('p', 'forge-queue-private', 'Only you see these names, never their words.'));
    if (list.parentNode !== slot) slot.append(list);
  };
  return { slot, paint };
}

/** The host retains ownership of the HUD and pointer; this panel owns only its children. */
export function openForge(host: ForgeHost, _from: 'anvil' | 'hud', transport: ForgeTransport = browserForgeTransport,
  options: { readonly readQueue?: ForgeQueueRead } = {}): ForgeHandle {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const abort = new AbortController();
  const kingdomId = KingdomIdSchema.parse(host.kingdomId);
  let open = true, busy = false, snapshot: ForgeChatStatusReply | null = null, wish: ForgeChatWish | null = null;
  let words = '', error = '', requestId: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let storageKey: string | undefined, startedAt = 0;
  let sessionScope: string | undefined;
  const save = (): boolean => {
    if (!storageKey || words.length > FORGE_CHAT_LIMITS.bodyBytes) return false;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ words, requestId, startedAt })); return true; } catch { return false; }
  };
  const veil = el('div', 'forge-wish-veil');
  const panel = el('section', 'forge-wish-panel cd-kit cd-plate');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'forge-wish-title');
  veil.append(panel); host.root.replaceChildren(veil); host.releasePointer();
  // The line is read only while the panel is open; closing stops it.
  const line = queueSlot();
  const queue = watchForgeQueue(kingdomId, options.readQueue ? { read: options.readQueue } : {});
  queue.subscribe(line.paint);
  const close = () => {
    if (!open) return; open = false; abort.abort(); queue.dispose(); if (timer) clearTimeout(timer); if (cooldownTimer) clearTimeout(cooldownTimer);
    host.root.replaceChildren(); host.restorePointer(); if (previous?.isConnected) previous.focus(); host.onClosed();
  };
  const button = (label: string, action: () => void, style = '') => {
    const b = el('button', `forge-wish-button ${style}`, label); b.type = 'button'; b.addEventListener('click', action); return b;
  };
  const schedule = () => { if (timer) clearTimeout(timer); if (open && active(wish)) timer = setTimeout(() => void refresh(), Date.now() - startedAt >= 30_000 ? FORGE_CHAT_LIMITS.slowPollMs : FORGE_CHAT_LIMITS.pollMs); };
  async function refresh() {
    try {
      if (!(await sameSession(true))) return;
      const next = await transport.status(kingdomId, requestId, abort.signal, sessionScope);
      if (!open) return; snapshot = next; wish = !requestId && words ? null : next.wish ?? (requestId ? { status: 'unknown', requestId, kingdomId, updatedAt: Date.now(), message: 'We are still checking whether your message was sent.' } : null); if (wish) { requestId = wish.requestId; if (wish.status !== 'not-sent' && wish.status !== 'unknown' && wish.status !== 'sending') words = ''; save(); } error = '';
    } catch (e) { if (!open) return; if (e instanceof ForgeTransportError && e.code === 'request-expired') { requestId = undefined; wish = null; save(); error = 'This wish’s status has expired. It will not be sent again. You may make a new wish.'; } else if (e instanceof ForgeTransportError && e.code === 'unauthenticated') { try { if (!(await sameSession(true))) return; } catch { /* handled below */ } error = e.message; } else error = 'The Forge could not be reached. Please check again.'; }
    render(); schedule();
  }
  async function authorize() {
    if (busy) return; busy = true; error = ''; render();
    if (words && !save()) { busy = false; error = 'Your draft could not be saved before leaving. Copy it before continuing to Twitch.'; render(); return; }
    try { if (!(await sameSession())) return; const url = await transport.authorize(kingdomId, abort.signal, sessionScope); if (open) location.assign(url); }
    catch (e) { if (open) { if (e instanceof ForgeTransportError && e.code === 'unauthenticated') { try { if (!(await sameSession())) return; } catch { /* show the original failure */ } } error = e instanceof Error ? e.message : 'Permission could not be opened.'; busy = false; render(); } }
  }
  async function send() {
    if (busy || !snapshot || snapshot.grant.status !== 'ready' || snapshot.availability.status !== 'ready' || active(wish)) return;
    const value = words.trim();
    if (!ForgeChatWishRequestSchema.safeParse({ version: 1, kingdomId, requestId: crypto.randomUUID(), words: value }).success) { error = `Write a wish on one line, up to ${FORGE_CHAT_LIMITS.words} characters.`; render(); return; }
    busy = true; render();
    try { if (!(await sameSession())) return; } catch { busy = false; error = 'Your session could not be checked. Please try again.'; render(); return; }
    requestId = crypto.randomUUID(); startedAt = Date.now();
    if (!save()) { busy = false; error = 'Your wish could not be saved for recovery. Please use Twitch chat instead.'; render(); return; }
    busy = true; error = ''; render();
    try { const result = await transport.wish(kingdomId, requestId, value, abort.signal, sessionScope); if (!open) return; wish = result; if (wish.status !== 'not-sent' && wish.status !== 'unknown' && wish.status !== 'sending') words = ''; save(); }
    catch (e) { if (!open) return; if (e instanceof ForgeTransportError && !e.ambiguous) { if (e.code === 'unauthenticated') { try { if (!(await sameSession())) return; } catch { /* show the original failure */ } } requestId = undefined; save(); error = e.message; } else wish = { status: 'unknown', requestId, kingdomId, updatedAt: Date.now(), message: 'The reply was lost. We are checking whether your message was sent.' }; }
    if (!open) return; busy = false; render(); schedule();
  }
  async function sameSession(allowAnonymous = false): Promise<boolean> {
    const current = await transport.session(abort.signal);
    if (!open) return false;
    if (current?.resumeScope === sessionScope && (Boolean(sessionScope) || allowAnonymous)) return true;
    if (storageKey) { try { sessionStorage.removeItem(storageKey); } catch { /* storage is unavailable */ } }
    if (timer) clearTimeout(timer); if (cooldownTimer) clearTimeout(cooldownTimer);
    words = ''; requestId = undefined; wish = null; snapshot = null; storageKey = undefined; busy = false;
    error = 'Your Chatdom session changed. Close and reopen the Forge to continue.'; render(); return false;
  }
  function render() {
    if (!open) return;
    const focused = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
    panel.replaceChildren();
    // While the Forge works the wish, the box steps aside: no dimming veil, a compact card docked low, so the
    // anvil and the ritual the card points to stay in view.
    const watching = Boolean(active(wish));
    veil.classList.toggle('forge-wish-veil--watching', watching);
    const head = el('header', 'forge-wish-head'); const top = el('div');
    top.append(el('p', 'forge-wish-kicker', 'THE FORGE'), el('h2', '', 'A wish for the kingdom'));
    top.querySelector('h2')!.id = 'forge-wish-title';
    const closeButton = button('Close', close, 'forge-wish-close'); closeButton.dataset.focus = 'close'; head.append(top, closeButton); panel.append(head);
    const body = el('div', 'forge-wish-body');
    if (!watching) body.append(el('p', 'forge-wish-intro', 'Imagine something for your home. Your words travel to the Forge through Twitch chat.'));
    if (!wish) body.append(line.slot);
    if (!snapshot && !error) body.append(el('p', 'forge-wish-note', 'Checking the Forge…'));
    if (snapshot?.grant.status === 'signed-out') body.append(el('div', 'forge-wish-slip', 'Sign in to Chatdom to send a wish from here. You can also wish directly in Twitch chat.'));
    if (snapshot?.grant.status === 'required') {
      const consent = el('div', 'forge-wish-slip'); consent.append(el('h3', '', 'A word before you wish'), el('p', '', 'Let the Forge post your wishes in Twitch chat as you.'));
      consent.append(el('p', '', 'Twitch will ask for your permission. You choose when to send each wish.'));
      const b = button('Continue to Twitch', () => void authorize()); b.disabled = busy; b.dataset.focus = 'consent'; consent.append(b); body.append(consent);
    }
    if (snapshot?.grant.status === 'unavailable') body.append(el('div', 'forge-wish-slip', snapshot.grant.message));
    if (snapshot?.availability.status === 'cold') body.append(el('div', 'forge-wish-slip', snapshot.availability.message));
    if (wish) {
      const [title, detail] = descriptions[wish.status]; const card = el('div', 'forge-wish-result'); card.setAttribute('role', 'status');
      card.append(el('p', 'forge-wish-kicker', 'YOUR WISH'), el('h3', '', title), el('p', '', detail));
      // While the wish is out, its place in line belongs on its own card.
      if (active(wish)) card.append(line.slot);
      if ('message' in wish && wish.message) card.append(el('p', 'forge-wish-cause', wish.message));
      if (!active(wish) && wish.status !== 'not-sent') card.append(button('Make another wish', () => { wish = null; requestId = undefined; save(); render(); } , 'forge-wish-secondary'));
      body.append(card);
      if (!active(wish)) body.append(line.slot);
    }
    if ((snapshot?.grant.status === 'ready' || snapshot?.grant.status === 'required') && (!wish || wish.status === 'not-sent')) {
      const label = el('label', 'forge-wish-label', 'What would you like to make?'); label.htmlFor = 'forge-wish-words';
      const field = el('textarea', 'forge-wish-field'); field.id = 'forge-wish-words'; field.rows = 3; field.value = words; field.disabled = busy; field.dataset.focus = 'words';
      const draftNote = el('p', 'forge-wish-note'); draftNote.setAttribute('role', 'status');
      field.addEventListener('input', () => { words = field.value; const saved = save(); counter.textContent = `${words.length} / ${FORGE_CHAT_LIMITS.words}`; draftNote.textContent = saved ? '' : 'Your words are only in this window. Copy them before leaving.'; });
      const counter = el('p', 'forge-wish-count', `${words.length} / ${FORGE_CHAT_LIMITS.words}`);
      body.append(label, field, counter, draftNote);
      if (snapshot.grant.status === 'ready') {
        const submit = button(busy ? 'Sending…' : 'Send wish to chat', () => void send()); submit.dataset.focus = 'send';
        const retryAt = wish?.status === 'not-sent' ? wish.retryAt : undefined;
        submit.disabled = busy || snapshot.availability.status !== 'ready' || (retryAt !== undefined && retryAt > Date.now());
        if (retryAt && retryAt > Date.now()) { body.append(el('p', 'forge-wish-note', `Try again after ${new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`)); if (cooldownTimer) clearTimeout(cooldownTimer); cooldownTimer = setTimeout(render, retryAt - Date.now()); }
        body.append(submit, el('p', 'forge-wish-footnote', 'Sent as your own !forge message in Twitch chat.'));
      }
    }
    if (error) { const message = el('p', 'forge-wish-error', error); message.setAttribute('role', 'status'); body.append(message, button('Check again', () => void refresh(), 'forge-wish-secondary')); }
    if (!active(wish) && !busy) { const fallback = el('p', 'forge-wish-fallback'); fallback.append('Or type ', el('strong', '', '!forge'), ' followed by your wish in Twitch chat.'); body.append(fallback); }
    panel.append(body);
    if (focused) (panel.querySelector<HTMLElement>(`[data-focus="${focused}"]:not(:disabled)`) ?? closeButton).focus();
  }
  const keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') {
      const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href]'));
      if (!items.length) { event.preventDefault(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1]?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0]?.focus(); }
    }
  };
  host.root.addEventListener('keydown', keydown); host.root.addEventListener('keyup', stopKey);
  const pointerEvents = ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;
  const stopPointer = (event: Event) => event.stopPropagation();
  for (const name of pointerEvents) host.root.addEventListener(name, stopPointer);
  function stopKey(event: KeyboardEvent) { event.stopPropagation(); }
  const originalClose = close;
  const cleanup = () => { host.root.removeEventListener('keydown', keydown); host.root.removeEventListener('keyup', stopKey); originalClose(); };
  // Local Escape and close button share the same idempotent teardown.
  abort.signal.addEventListener('abort', () => { host.root.removeEventListener('keydown', keydown); host.root.removeEventListener('keyup', stopKey); for (const name of pointerEvents) host.root.removeEventListener(name, stopPointer); }, { once: true });
  render(); panel.querySelector<HTMLElement>('button')?.focus();
  void (async () => {
    try {
      const current = await transport.session(abort.signal); if (!open) return;
      const prefix = 'chatdom.forge.draft.'; const scope = current?.resumeScope; sessionScope = scope;
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i); if (key?.startsWith(prefix) && (!scope || !key.startsWith(`${prefix}${scope}.`))) sessionStorage.removeItem(key); }
        if (scope) {
          storageKey = `${prefix}${scope}.${kingdomId}`;
          const raw = sessionStorage.getItem(storageKey); const draft: unknown = raw ? JSON.parse(raw) : null;
          if (draft && typeof draft === 'object') {
            if ('words' in draft && typeof draft.words === 'string' && draft.words.length <= FORGE_CHAT_LIMITS.bodyBytes) words = draft.words;
            if ('requestId' in draft && ForgeChatRequestIdSchema.safeParse(draft.requestId).success) requestId = draft.requestId as string;
            if ('startedAt' in draft && typeof draft.startedAt === 'number') startedAt = draft.startedAt;
          }
        }
      } catch { storageKey = undefined; }
      await refresh();
    } catch { if (open) { error = 'Your session could not be checked. Please try again.'; render(); } }
  })();
  return { isOpen: () => open, close: cleanup, dispose: cleanup };
}
