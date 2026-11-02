/** One still per capture lease. Run the other standard viewport in a separate invocation. */
export function captureSize(fallback = 'desktop') {
  const viewport = process.env.GATHER_VIEWPORT ?? fallback;
  if (!['desktop', 'phone'].includes(viewport)) throw new Error('GATHER_VIEWPORT must be desktop or phone.');
  return viewport === 'phone' ? [390, 844] : [1440, 900];
}
