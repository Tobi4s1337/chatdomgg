/** What the allowance under a parchment field says. Counts characters as the browser's maxlength does. */
export function allowance(value: string, max: number): { used: number; left: number; words: string; near: boolean } {
  const used = value.length, left = Math.max(0, max - used);
  return { used, left, words: left === 0 ? 'No room left' : left === 1 ? '1 letter left' : `${left} letters left`, near: left <= Math.min(20, Math.ceil(max * 0.1)) };
}
