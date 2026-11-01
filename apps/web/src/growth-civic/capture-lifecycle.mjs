/** Capture one still per lease, releasing it before the next still starts. */
export async function captureEach(items, { acquire, capture }) {
  for (const item of items) {
    const release = await acquire();
    try {
      await capture(item);
    } finally {
      await release();
    }
  }
}
