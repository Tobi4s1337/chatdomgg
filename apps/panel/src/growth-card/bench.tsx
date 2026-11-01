import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { simulatedPassport } from '../../../../packages/ui/src/passport/fixtures';
import { EarnedShelf } from './EarnedShelf';
import { createEarnedShelf, type ShelfState } from './shelf';
import type { PassportReplyView } from '../../../../packages/ui/src/passport/session';

type BenchControls = { pending(): void; hide(): void; late(): void; empty(): void; invalid(): void };

function Bench() {
  const [state, setState] = createSignal<ShelfState>({ kind: 'loading' });
  const shelf = createEarnedShelf(setState);
  const original = simulatedPassport('few');
  const first = original.keepsakes.items[0]!;
  const book = { ...original, keepsakes: { ...original.keepsakes, items: [...original.keepsakes.items, { ...first, id: 'bench:long', name: 'The small lantern carried all the way home' }, { ...first, id: 'bench:extra', name: 'A ribbon from the road' }] } };
  shelf.replace(book.holder.personId, { origin: 'simulated', travels: 'shown', revision: 1 }, async () => ({ kind: 'book', book }));
  let resolve: ((reply: PassportReplyView) => void) | undefined;
  const controls: BenchControls = {
    pending() { shelf.replace(book.holder.personId, { origin: 'simulated', travels: 'shown', revision: 3 }, () => new Promise(done => { resolve = done; })); },
    hide() { shelf.replace(book.holder.personId, { origin: 'simulated', travels: 'hidden', revision: 4 }, null); },
    late() { resolve?.({ kind: 'book', book }); },
    empty() { shelf.replace(book.holder.personId, { origin: 'simulated', travels: 'shown', revision: 5 }, async () => ({ kind: 'book', book: { ...book, keepsakes: { items: [], nextCursor: null } } })); },
    invalid() { shelf.replace(book.holder.personId, { origin: 'simulated', travels: 'shown', revision: 6 }, async () => undefined); },
  };
  (window as Window & { __earnedShelfBench?: BenchControls }).__earnedShelfBench = controls;
  onCleanup(() => { delete (window as Window & { __earnedShelfBench?: BenchControls }).__earnedShelfBench; shelf.close(); });
  return <main style={{ padding: '18px', 'min-height': '100vh', 'box-sizing': 'border-box' }}><div style={{ padding: '20px', background: '#f0e2c2', border: '3px double #ad8856', 'box-shadow': '0 5px 18px #1c0c0a88' }}><p style={{ color: '#765135', 'font-family': 'sans-serif', 'font-size': '12px', 'letter-spacing': '.1em' }}>CITIZEN CARD · SIMULATED</p><h1 style={{ color: '#382719', 'font-size': '25px', 'font-weight': 'normal' }}>A place remembered</h1><EarnedShelf state={state()} /></div></main>;
}
render(() => <Bench />, document.getElementById('app')!);
