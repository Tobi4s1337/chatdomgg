// The Bits shelf: a small fixed menu of moments the whole kingdom sees. It appears only
// when Twitch says Bits work here and a service can verify delivery; Twitch's own
// window confirms every use. Nothing on it lasts past a day, and nothing on it brings
// light, rank, coals or a place. The panel never grants a product on its own word.
import { For, Show } from 'solid-js';
import type { PanelSnapshot, Shelf, ShelfProduct } from '../model';
import { WindowGlyph } from './art';

type Offered = Extract<Shelf, { kind: 'offered' }>;

const bits = (n: number) => n.toLocaleString('en-US');

function Stays(props: { product: ShelfProduct }) {
  return <p class="cp-stays" classList={{ day: props.product.stays.kind === 'day' }}>
    <Show when={props.product.stays.kind === 'day' ? props.product.stays : null} fallback={<span>For the moment only</span>}>{day =>
      <span>{day().what} until {day().until}</span>}
    </Show>
  </p>;
}

function Product(props: { product: ShelfProduct; shelf: Offered; onUse: (sku: string) => void }) {
  const request = () => props.shelf.request;
  const mine = () => { const r = request(); return r.kind !== 'idle' && r.sku === props.product.sku ? r.kind : null; };
  const busy = () => request().kind === 'confirming';
  return <li class="cp-product" data-request={mine() ?? 'idle'}>
    <div class="cp-product-words">
      <p class="cp-product-title">{props.product.title}</p>
      <p class="cp-product-what">{props.product.what}</p>
      <Stays product={props.product} />
    </div>
    <button type="button" class="cp-bits" disabled={busy()} onClick={() => props.onUse(props.product.sku)}
      aria-label={`Use ${bits(props.product.bits)} Bits: ${props.product.title}`}>
      <small>Use</small><strong>{bits(props.product.bits)}</strong><small>Bits</small>
    </button>
    <Show when={mine()}>{kind =>
      <p class="cp-product-answer" role="status" classList={{ pending: kind() === 'confirming' }}>
        <WindowGlyph lit={false} pending={kind() === 'confirming'} />
        <span>{kind() === 'confirming'
          ? <><strong>Simulating confirmation…</strong><small>No Twitch window opens and no Bits are used.</small></>
          : <><strong>Closed without using Bits</strong><small>Nothing was used and nothing changed in the kingdom.</small></>}</span>
      </p>}
    </Show>
  </li>;
}

export function ShelfSheet(props: { snap: PanelSnapshot; onUse: (sku: string) => void }) {
  const shelf = () => props.snap.shelf.kind === 'offered' ? props.snap.shelf as Offered : null;
  return <Show when={shelf()}>{offered =>
    <div class="cp-sheet">
      <p class="cp-lede">Moments for all of {props.snap.kingdom?.name ?? 'the kingdom'}: seen on stream and in every panel, with your name.</p>
      <ul class="cp-products">
        <For each={offered().products}>{product => <Product product={product} shelf={offered()} onUse={props.onUse} />}</For>
      </ul>
      <p class="cp-fine">Nothing here lasts past a day, and nothing brings light, rank, coals or a place. Twitch confirms every use of Bits in its own window.</p>
      <Show when={props.snap.source.kind === 'simulated'}>
        <p class="cp-fine cp-simulated-note">Simulated: Twitch’s window never opens here, and no Bits are ever used.</p>
      </Show>
    </div>}
  </Show>;
}
