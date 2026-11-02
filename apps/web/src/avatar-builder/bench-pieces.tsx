import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import type { CitizenLook } from '../../../../packages/content/src/avatar-style';
import { TIER_WORDS } from './cards';
import { TABS, type Control, type TileOption } from './catalogue';
import { allPieceCards, type PieceCard } from './pieces';
import { createThumbPainter, type ThumbPainter } from './thumbs';
import './builder.css';
import './look.css';

/*
 * A contact sheet of the wardrobe's pieces for the dev bench: every new piece (or every piece, `?pieces=all`) worn by
 * one citizen, drawn exactly as its builder tile is, with its card's name, story and tier. Grouped by kind.
 */

type Tiles = Extract<Control, { kind: 'tiles' }>;
const tiles = TABS.flatMap(t => t.controls).filter((c): c is Tiles => c.kind === 'tiles' && !!c.piece);

interface Entry { readonly card: PieceCard; readonly control: Tiles; readonly option: TileOption }

function Sheet(props: { entry: Entry; look: CitizenLook; painter: ThumbPainter }): JSX.Element {
  const [url, setUrl] = createSignal<string | null>(null);
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const { card, control, option } = props.entry;
  props.painter.paint({ look: option.apply(props.look), view: control.view, size: 176 }, controller.signal).then(setUrl, () => undefined);
  return <figure class="bp-piece" data-tier={card.tier}>
    <span class="ab-thumb bp-thumb" classList={{ 'ab-thumb-waiting': !url() }}><Show when={url()}>{u => <img src={u()} alt="" />}</Show></span>
    <figcaption>
      <span class="bp-name">{card.name}</span>
      <span class="bp-tier">{TIER_WORDS[card.tier]}{card.isNew ? ' · new' : ''}</span>
      <span class="bp-story">{card.story}</span>
    </figcaption>
  </figure>;
}

export function PiecesSheet(props: { look: CitizenLook; all: boolean }): JSX.Element {
  const painter = createThumbPainter();
  onCleanup(() => painter.dispose());
  const entries: Entry[] = [];
  for (const card of allPieceCards()) {
    if (!props.all && !card.isNew) continue;
    const control = tiles.find(c => c.piece === card.kind);
    const option = control?.options.find(o => o.id === card.id);
    if (control && option) entries.push({ card, control, option });
  }
  const kinds = [...new Set(entries.map(e => e.control.label))];
  return <div class="bp cd-kit">
    <header class="bp-head"><h1>{props.all ? 'Every piece in the wardrobe' : 'New in the wardrobe'}</h1><p>{entries.length} pieces</p></header>
    <For each={kinds}>{kind => <section class="bp-kind">
      <h2>{kind}</h2>
      <div class="bp-grid"><For each={entries.filter(e => e.control.label === kind)}>{entry => <Sheet entry={entry} look={props.look} painter={painter} />}</For></div>
    </section>}</For>
  </div>;
}
