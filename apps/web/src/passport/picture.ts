import type { VisiblePassportView } from '@chatdom/ui/passport';

let snapshots = 0;

/**
 * The share route with a parameter naming one shown snapshot. A document may reuse an image it already holds for
 * the same URL whatever the response's caching said, so every snapshot the page shows asks for its own picture and
 * a book read afresh never shows the print of the one before it. The handler ignores the parameter and always reads
 * the book afresh; the link people copy stays the clean route.
 */
export function pictureOf(imageUrl: string, book: Pick<VisiblePassportView, 'revision'>): string {
  const [base = '', hash] = imageUrl.split('#', 2) as [string, string | undefined];
  const snapshot = `snapshot=${encodeURIComponent(`${book.revision}.${++snapshots}`)}`;
  return `${base}${base.includes('?') ? '&' : '?'}${snapshot}${hash === undefined ? '' : `#${hash}`}`;
}
