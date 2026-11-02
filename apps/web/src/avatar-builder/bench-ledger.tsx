import { onCleanup, onMount, type JSX } from 'solid-js';
import '../play/ledger/ledger.css';
import type { KingdomId } from '@chatdom/shared';
import type { CitizenEntitlements, CitizenLook } from '../../../../packages/content/src/avatar-style';
import { cornerCap, flourish } from '../play/ledger/marks';
import type { LookClient } from './look-client';
import { mountLedgerPage } from './play-ui';

/*
 * The "Your look" page staged in a ledger for the dev bench's stills: the ledger's own book, with play's pages listed
 * on the left leaf and the look page open on the right, answered by a stand-in for the realm.
 */
export function LedgerBench(props: { name: string; look: CitizenLook; entitlements: CitizenEntitlements }): JSX.Element {
  let host: HTMLDivElement | undefined;
  const client: LookClient = {
    mine: async () => ({ status: 'saved', token: `lk.${'0'.repeat(40)}`, look: props.look, savedAt: Date.UTC(2026, 10, 1), entitlements: props.entitlements, granted: [] }),
    save: async look => ({ ok: true, token: `lk.${'0'.repeat(40)}`, look, savedAt: Date.now() }),
    authority: () => ({ save: async look => ({ ok: true, look }) }),
  };
  onMount(() => {
    if (!host) return;
    const dispose = mountLedgerPage(host, {
      deps: { client, memory: null, sounds: undefined, saved: () => undefined, onSaved: () => () => undefined },
      kingdomId: '1' as KingdomId, name: props.name, open: () => undefined,
    });
    onCleanup(dispose);
  });
  const pages = ['Settings', 'Way home', 'Your look', 'Build', 'Help'];
  return <div class="pl-ledger cd-kit" data-phase="open" style={{ position: 'fixed', background: 'linear-gradient(180deg, #2a2148, #4a2f4f)' }}>
    <div class="pl-book">
      <div class="pl-boards" aria-hidden="true">
        <span class="pl-corner" data-corner="tl">{cornerCap()}</span><span class="pl-corner" data-corner="tr">{cornerCap()}</span>
        <span class="pl-corner" data-corner="bl">{cornerCap()}</span><span class="pl-corner" data-corner="br">{cornerCap()}</span>
        <span class="pl-clasp" />
      </div>
      <div class="pl-leaves">
        <div class="pl-leaf pl-leaf-contents">
          <header class="pl-title"><p class="pl-eyebrow">Kept by {props.name}</p><h2 class="pl-name">The Ledger</h2>{flourish()}</header>
          <nav class="pl-contents"><div class="pl-tabs" role="tablist">
            {pages.map((title, i) => <button type="button" role="tab" class="pl-tab" aria-selected={title === 'Your look' ? 'true' : 'false'}>
              <span class="pl-tab-name">{title}</span><span class="pl-tab-leader" /><span class="pl-tab-folio">{['i', 'ii', 'iii', 'iv', 'v'][i]}</span></button>)}
          </div></nav>
        </div>
        <div class="pl-gutter" aria-hidden="true" />
        <section class="pl-leaf pl-leaf-page">
          <header class="pl-page-head"><p class="pl-eyebrow">Folio iii</p><h2 class="pl-page-title">Your look</h2></header>
          <div class="pl-page-body" data-page="look"><div ref={el => { host = el; }} class="pl-provider" data-provider="look" /></div>
        </section>
      </div>
    </div>
  </div>;
}
