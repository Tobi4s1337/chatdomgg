import { Buffer } from 'node:buffer';

export const ITEM_PAGE_ROWS = 32;
export const ITEM_REPLY_BYTES = 48 * 1024;
/** Leave room for the reply envelope and its bounded request id. One lookahead row detects another page. */
export function itemPage<T>(rows: readonly { readonly cursor: string; readonly value: T }[]) {
  const values: T[] = [];
  let bytes = 1024;
  for (const row of rows.slice(0, ITEM_PAGE_ROWS)) {
    const size = Buffer.byteLength(JSON.stringify(row.value), 'utf8') + 1;
    if (bytes + size > ITEM_REPLY_BYTES) break;
    bytes += size; values.push(row.value);
  }
  if (rows.length && !values.length) throw new Error('An item record exceeds the private reply limit.');
  return { values, next: rows.length > values.length ? rows[values.length - 1]!.cursor : null };
}
