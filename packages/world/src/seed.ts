/** Stable seed identity shared by layout generation and independent terrain producers. */
export function seedHash(text: string): number {
  let h=2166136261; for(let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0;
}
