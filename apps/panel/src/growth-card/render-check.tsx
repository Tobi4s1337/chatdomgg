import { renderToString } from 'solid-js/web';
import { EarnedShelf } from './EarnedShelf';
import type { ShelfState } from './shelf';
export function renderShelf(state: ShelfState): string { return renderToString(() => <EarnedShelf state={state} />); }

export function renderMore(state: ShelfState): string { return renderToString(() => <EarnedShelf state={state} onOpenPassport={() => {}} />); }

export function renderUntrustedName(): string {
  const item = { id: 'item', name: '<img src=x onerror=alert(1)>', earnedAt: 1, artHash: null,
    kingdom: { kingdomId: '1', name: '<script>kingdom</script>', crest: { key: 'crest', shape: 'round' as const, charge: 'oak' as const, colours: ['#123456', '#ffffff'], assetHash: null } } };
  return renderToString(() => <EarnedShelf state={{ kind: 'ready', origin: 'simulated', items: [item], hasMore: false }} />);
}
