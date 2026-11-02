import '@chatdom/ui/kit.css';
import './page.css';
import type { ForgeLedgerEntry, ForgeLedgerView } from '@chatdom/shared';
import { forgeLedgerByline, forgeLedgerCopies, forgeLedgerSummary, watchForgeLedger, type ForgeLedgerRead, type ForgeLedgerState } from './read';
import { drawForgeKeepsake } from './portrait';

/*
 * "The forge remembers", as a page of the Esc ledger (play's slot). Every piece this kingdom's forge has made, newest
 * first: the piece itself, its title and plaque, and who wished for it and when. Never a wish's words.
 */

const MOTIFS: Record<ForgeLedgerEntry['plan']['motif'], string> = {
  'sleeping-dragon': 'sleeping dragon', 'crescent-moon': 'crescent moon', 'watchful-owl': 'watchful owl', 'sleeping-fox': 'sleeping fox',
  sunflower: 'sunflower', 'scallop-shell': 'scallop shell', 'shooting-star': 'shooting star',
};
const KINDS: Record<ForgeLedgerEntry['plan']['kind'], string> = { chimney: 'chimney', lantern: 'lantern', weathervane: 'weathervane' };
/** "A copper owl weathervane" — what the portrait shows, for people who cannot see it. */
export function forgeKeepsakeDescription(entry: Pick<ForgeLedgerEntry, 'plan'>): string {
  const finish = entry.plan.finish === 'native' ? '' : `${entry.plan.finish} `;
  const words = `${finish}${MOTIFS[entry.plan.motif]} ${KINDS[entry.plan.kind]}`;
  return `${/^[aeiou]/.test(words) ? 'An' : 'A'} ${words}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface ForgeLedgerPageOptions {
  readonly read?: ForgeLedgerRead;
  readonly pollMs?: number;
  /** Fixed "now" for the date lines (benches and tests). */
  readonly now?: () => number;
}

/** Mount the page into `root` (play's page host). Returns its own cleanup. */
export function mountForgeLedgerPage(root: HTMLElement, kingdomId: string, options: ForgeLedgerPageOptions = {}): () => void {
  const page = el('div', 'forge-ledger cd-kit');
  page.setAttribute('aria-live', 'polite');
  root.append(page);
  const now = options.now ?? Date.now;
  const watch = watchForgeLedger(kingdomId, { ...(options.read ? { read: options.read } : {}), ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  const pending = new Map<HTMLCanvasElement, ForgeLedgerEntry>();
  let frame = 0, disposed = false;
  // Portraits are drawn a few per frame, nearest first, so opening a long ledger never stalls the walk behind it.
  const drawSome = () => {
    frame = 0;
    let budget = 4;
    for (const [canvas, entry] of pending) {
      if (budget-- <= 0) break;
      pending.delete(canvas);
      try { drawForgeKeepsake(canvas, entry); } catch { canvas.closest('.forge-ledger-plate')?.classList.add('forge-ledger-plate--bare'); }
    }
    if (pending.size && !disposed) frame = requestAnimationFrame(drawSome);
  };
  const schedule = () => { if (!frame && pending.size && !disposed) frame = requestAnimationFrame(drawSome); };

  function entryNode(entry: ForgeLedgerEntry): HTMLLIElement {
    const item = el('li', 'forge-ledger-entry');
    item.dataset.piece = entry.id;
    const plate = el('figure', 'forge-ledger-plate');
    const canvas = el('canvas', 'forge-ledger-portrait');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', forgeKeepsakeDescription(entry));
    plate.append(canvas);
    const words = el('div', 'forge-ledger-words');
    words.append(el('h3', 'forge-ledger-title', entry.title), el('p', 'forge-ledger-plaque', entry.plaque));
    const by = el('p', 'forge-ledger-by');
    by.append(el('span', 'forge-ledger-by-label', 'Wished for by '), document.createTextNode(forgeLedgerByline(entry, now())));
    words.append(by);
    const copies = forgeLedgerCopies(entry);
    if (copies) words.append(el('p', 'forge-ledger-copies', copies));
    item.append(plate, words);
    pending.set(canvas, entry);
    return item;
  }

  function render(state: ForgeLedgerState) {
    for (const canvas of [...pending.keys()]) if (!page.contains(canvas)) pending.delete(canvas);
    if (state.kind === 'loading') { page.replaceChildren(el('p', 'forge-ledger-note', 'Reading the forge’s memory…')); page.dataset.state = 'loading'; return; }
    if (state.kind === 'unavailable') { page.replaceChildren(el('p', 'forge-ledger-note', 'The forge’s memory cannot be read just now. It will try again on its own.')); page.dataset.state = 'unavailable'; return; }
    if (state.kind === 'no-forge') { page.replaceChildren(el('p', 'forge-ledger-note', 'This kingdom has no forge yet.')); page.dataset.state = 'no-forge'; return; }
    renderLedger(state.view);
  }

  function renderLedger(view: ForgeLedgerView) {
    page.dataset.state = view.total ? 'ledger' : 'empty';
    const summary = el('p', 'forge-ledger-summary', forgeLedgerSummary(view));
    if (!view.total) {
      const empty = el('div', 'forge-ledger-empty');
      empty.append(el('span', 'forge-ledger-empty-mark'), summary);
      page.replaceChildren(empty);
      return;
    }
    // Keep the pieces already drawn; only new ones are built and painted.
    const previous = new Map([...page.querySelectorAll<HTMLLIElement>('.forge-ledger-entry')].map(node => [node.dataset.piece!, node]));
    const list = el('ol', 'forge-ledger-list');
    for (const entry of view.entries) {
      const known = previous.get(entry.id);
      const fresh = entryNode(entry);
      if (known && known.querySelector('.forge-ledger-by')?.textContent === fresh.querySelector('.forge-ledger-by')?.textContent) {
        pending.delete(fresh.querySelector('canvas')!);
        list.append(known);
      } else list.append(fresh);
    }
    page.replaceChildren(summary, list);
    schedule();
  }

  const unsubscribe = watch.subscribe(render);
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    unsubscribe(); watch.dispose(); pending.clear(); page.remove();
  };
}

/**
 * The page as play's ledger slot expects it (`LedgerPageProvider`, play's SEAMS section B). play's slot module
 * registers it with one line; nothing here imports play.
 */
export const FORGE_LEDGER_PAGE = {
  id: 'forged',
  title: 'The forge remembers',
  order: 45,
  available: (ctx: { readonly mode: 'walking' | 'watching' | 'stream' }) => ctx.mode !== 'stream',
  mount: (host: HTMLElement, ctx: { readonly kingdomId: string }) => mountForgeLedgerPage(host, ctx.kingdomId),
} as const;
