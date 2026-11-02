import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { PanelSettings, PanelSettingsReading } from '../../../packages/shared/src/panel';
import { connectHelper, type HelperProduct } from './helper';
import { createConfigTransport } from './settings/transport';
import { BACKEND_ORIGIN } from './adapters/production';
import { GIFT_CATALOGUE } from './gifts/catalogue';
import { createPanelSound } from './sound';
import './panel.css';
import './window.css';
import './config.css';

export default function Config(props: { live: boolean }) {
  const helper = connectHelper(), transport = createConfigTransport(helper, BACKEND_ORIGIN), sound = createPanelSound();
  const [reading, setReading] = createSignal<PanelSettingsReading | null>(null);
  const [draft, setDraft] = createSignal<PanelSettings | null>(null);
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal('Waiting for Twitch…');
  const [busy, setBusy] = createSignal(false), [products, setProducts] = createSignal<readonly HelperProduct[]>([]), [muted, setMuted] = createSignal(sound.muted());
  let generation = 0, lastAuthorization = helper.authorization?.(), lastIdentity = helper.uiIdentity?.();
  const broadcaster = () => { const s = helper.status(); return s.kind === 'authorized' && s.role === 'broadcaster'; };
  const cue = () => { sound.gesture(); sound.play('tap'); };
  async function load(preserveDraft = false) {
    const n = ++generation; setBusy(false);
    if (!preserveDraft) { setReading(null); setDraft(null); setPending(false); setProducts([]); }
    if (!broadcaster()) { setReading(null); setDraft(null); setPending(false); setStatus(helper.status().kind === 'absent' ? 'Open this page in Twitch to configure your panel.' : 'Waiting for the broadcaster’s Twitch connection.'); return; }
    if (!preserveDraft || !draft()) setStatus('Opening your settings…');
    // Prices are optional display evidence. A stuck Helper must not block settings or Hide.
    void (helper.getProducts?.().catch(() => []) ?? Promise.resolve([])).then(list => { if (n === generation) setProducts(list); });
    const value = await transport.readSync();
    if (n !== generation) return;
    if (preserveDraft && dirty()) {
      if (!value) setStatus('Unsaved changes. Settings could not be refreshed.');
      else if (JSON.stringify(value.reading) !== JSON.stringify(reading())) setStatus('Settings changed elsewhere. Your edits are still here; save to check for a conflict.');
      else { setPending(value.publication === 'pending'); setStatus('Unsaved changes'); }
      return;
    }
    setReading(value?.reading ?? null); setDraft(value?.reading.settings ?? null);
    setPending(value?.publication === 'pending');
    setStatus(value ? (value.publication === 'pending' ? 'Saved in the kingdom; waiting for Twitch to confirm.' : '') : 'Settings are unavailable. Please try again.');
  }
  const unsub = helper.subscribe(() => {
    const next = helper.authorization?.(), identity = helper.uiIdentity?.();
    if (next !== lastAuthorization || identity !== lastIdentity || !broadcaster()) {
      const preserve = !!identity && identity === lastIdentity && broadcaster();
      lastAuthorization = next; lastIdentity = identity; void load(preserve);
    }
  });
  const unSound = sound.subscribe(setMuted);
  const edit = (f: (s: PanelSettings) => PanelSettings) => { const s = draft(); if (s && !busy()) { cue(); setDraft(f(s)); setStatus('Unsaved changes'); } };
  async function save(next = draft()) {
    const current = reading(); if (!next || !current || busy()) return;
    cue(); setBusy(true); setStatus('Saving to the kingdom…');
    const n = generation; const result = await transport.save(current.revision, next); if (n !== generation) return; setBusy(false);
    if (result.kind === 'saved') { setPending(false); setReading(result.reading); setDraft(result.reading.settings); setStatus('Saved'); }
    else if (result.kind === 'conflict') { setPending(true); setReading(result.reading); setDraft(result.reading.settings); setStatus('Settings changed elsewhere. The latest version is shown.'); }
    else if (result.kind === 'pending') { setReading(result.reading); setDraft(result.reading.settings); setPending(true); setStatus('Saved in the kingdom; waiting for Twitch to confirm.'); }
    else if (result.kind === 'changed') { setStatus('Twitch connection changed. Reopening settings…'); void load(true); }
    else setStatus(result.kind === 'refused' ? 'Twitch did not allow this change.' : 'Could not save. Please try again.');
  }
  async function retry() {
    const current = reading(); if (!current || busy() || dirty()) return;
    cue(); setBusy(true); setStatus('Checking Twitch…');
    const n = generation; const result = await transport.retrySync(current); if (n !== generation) return; setBusy(false);
    if (result.kind === 'saved') { setPending(false); setStatus('Saved'); }
    else if (result.kind === 'conflict') { setReading(result.reading); setDraft(result.reading.settings); setPending(true); setStatus('Settings changed elsewhere. The latest version is shown.'); }
    else if (result.kind === 'changed') { void load(true); }
    else { setPending(true); setStatus('Saved in the kingdom; waiting for Twitch to confirm.'); }
  }
  const toggleTab = (key: 'you' | 'gifts') => edit(s => ({ ...s, tabs: { ...s.tabs, [key]: !s.tabs[key] } }));
  const selection = (id: string) => draft()?.gifts.find(g => g.giftId === id);
  const toggleGift = (id: string) => edit(s => ({ ...s, gifts: s.gifts.some(g => g.giftId === id) ? s.gifts.filter(g => g.giftId !== id) : s.gifts.length < 8 ? [...s.gifts, { giftId: id, band: 'a' }] : s.gifts }));
  const amount = (sku: string) => { const s = helper.status(); if (s.kind !== 'authorized' || !s.bits) return null; const p = products().find(item => item.sku === sku && item.cost.type?.toLowerCase() === 'bits' && (!item.expiration || Date.parse(item.expiration) > Date.now())); const n = p && Number(p.cost.amount); return n && Number.isInteger(n) && n > 0 && n <= 10000 ? `${n} Bits` : null; };
  const dirty = () => !!draft() && !!reading() && JSON.stringify(draft()) !== JSON.stringify(reading()!.settings);
  onMount(() => { document.documentElement.classList.add('cp-document', 'cp-config-document'); void load(); void document.fonts.ready.then(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }); });
  onCleanup(() => { generation++; unsub(); unSound(); transport.dispose(); sound.dispose(); document.documentElement.classList.remove('cp-document', 'cp-config-document'); });
  return <div class="cp-frame"><div class="cp cp-config"><header class="cw-head"><span class="cw-mark" aria-hidden="true">✦</span><h1>{props.live ? 'Tonight’s panel' : 'Your panel'}</h1><button class="cw-sound" aria-label={muted() ? 'Turn panel sound on' : 'Mute panel sound'} aria-pressed={!muted()} onClick={() => { sound.setMuted(!muted()); if (!muted()) cue(); }}>{muted() ? '♪̸' : '♪'}</button></header>
    <main class="cfg-page"><div class="cfg-settings">
      <section class="cfg-sheet"><p class="cfg-kicker">YOUR KINGDOM · {props.live ? 'LIVE' : 'SETTINGS'}</p><h2 class="cfg-title">{props.live ? 'A quiet switch for tonight' : 'A window for your people'}</h2><p class="cfg-body">{props.live ? 'Pause panel gifts whenever you need a quieter moment.' : 'Choose what your community finds beneath the stream.'}</p><p class="cfg-connection"><span classList={{ 'cfg-dot': true, 'is-on': reading()?.connected }} />{reading() ? (reading()!.connected ? 'Kingdom connected' : 'Kingdom not connected') : 'Connection unavailable'}</p></section>
      <Show when={status()}><p class="cfg-notice" role="status">{status()}</p></Show>
      <Show when={pending() && reading()}><button class="cfg-retry" disabled={busy() || dirty()} onClick={() => void retry()}>Check Twitch again</button></Show>
      <Show when={draft()}>{settings => <>
        <Show when={props.live} fallback={<><section class="cfg-sheet"><p class="cfg-kicker">THE WINDOW</p><h2 class="cfg-title">Choose the tabs</h2><p class="cfg-body">Kingdom is always open.</p><For each={['you', 'gifts'] as const}>{key => <div class="cfg-row"><div class="cfg-row-words"><strong>{key === 'you' ? 'You' : 'Gifts'}</strong><small>{key === 'you' ? 'A citizen’s own place' : 'Celebrations for the kingdom'}</small></div><button class="cfg-lever" role="switch" aria-label={`Show ${key} tab`} aria-checked={settings().tabs[key]} disabled={busy()} onClick={() => toggleTab(key)}><span class="cfg-slot"><i /></span><span class="cfg-lever-words">{settings().tabs[key] ? 'ON' : 'OFF'}</span></button></div>}</For></section>
          <section class="cfg-sheet"><p class="cfg-kicker">THE GIFT SHELF</p><h2 class="cfg-title">Little celebrations</h2><p class="cfg-body">Choose up to eight. Each band brings the same moment.</p><p class="cfg-count">{settings().gifts.length} of 8 chosen</p><For each={GIFT_CATALOGUE}>{gift => <div class="cfg-gift"><button class="cfg-item" role="checkbox" aria-checked={!!selection(gift.id)} disabled={busy() || (!selection(gift.id) && settings().gifts.length >= 8)} onClick={() => toggleGift(gift.id)}><span class="cfg-tick" /><span class="cfg-item-words"><strong>{gift.title}</strong><small>{gift.what}</small></span></button><Show when={selection(gift.id)}>{picked => <fieldset class="cfg-band"><legend>Band</legend><div class="cfg-band-options"><For each={gift.bands}>{(band, index) => { const id = ['a', 'b', 'c'][index()] as 'a' | 'b' | 'c'; return <label class="cfg-band-option"><input type="radio" name={`band-${gift.id}`} value={id} checked={picked().band === id} disabled={busy()} onChange={() => edit(s => ({ ...s, gifts: s.gifts.map(g => g.giftId === gift.id ? { ...g, band: id } : g) }))} /><span>{`Band ${id.toUpperCase()}`}<Show when={amount(band.id)}>{bits => <small>{bits()}</small>}</Show></span></label>; }}</For></div></fieldset>}</Show></div>}</For></section><button class="cfg-save" disabled={busy() || !dirty()} onClick={() => void save()}>Save changes</button></>}>
          <section class="cfg-sheet cfg-hide"><p class="cfg-kicker">PANEL GIFTS</p><h2 class="cfg-title">{settings().hidden ? 'Gifts are paused' : 'Panel gifts'}</h2><p class="cfg-body">Pausing stops new gifts and holds pending gifts until you resume. Gifts appear only when eligible and ready.</p><button class="cfg-save" disabled={busy()} onClick={() => void save({ ...settings(), hidden: !settings().hidden })}>{settings().hidden ? 'Resume gifts' : 'Hide panel gifts'}</button></section>
        </Show>
      </>}</Show>
      <Show when={!draft() && broadcaster()}><button class="cfg-retry" onClick={() => { cue(); void load(); }}>Try again</button></Show>
    </div></main></div></div>;
}
