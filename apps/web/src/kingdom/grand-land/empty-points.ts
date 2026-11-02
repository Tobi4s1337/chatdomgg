import * as THREE from 'three';

/** How often the scene is searched again for point pools added since (the realm Forge mounts its own late). */
const RESCAN_MS = 2000;

/**
 * Never submit a draw that cannot show anything. Particle pools keep a per-point `aAlpha` attribute and stay
 * allocated while idle: the kingdom's three Forge emitters alone submitted 21 zero-alpha pools to every pass
 * (42 of the stream's draws, spec 56 counts every call). Just before a frame is drawn, `update` hides each visible
 * pool whose alphas are all zero and shows it again as soon as one point has alpha. It only ever shows what it hid
 * itself, so an owner that hides its own pool keeps it hidden.
 */
export function createEmptyPointSkipper(root: THREE.Object3D) {
  let pools: THREE.Points[] = [], scannedAt = -Infinity;
  const hidden = new Set<THREE.Points>();
  const alphaOf = (points: THREE.Points) => points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute | undefined;
  function scan() {
    const found: THREE.Points[] = [];
    root.traverse(object => { if ((object as THREE.Points).isPoints && alphaOf(object as THREE.Points)) found.push(object as THREE.Points); });
    for (const points of hidden) if (!found.includes(points)) { points.visible = true; hidden.delete(points); }
    pools = found;
  }
  return {
    update(now: number): number {
      if (now - scannedAt >= RESCAN_MS) { scan(); scannedAt = now; }
      let skipped = 0;
      for (const points of pools) {
        const alpha = alphaOf(points);
        let lit = false;
        if (alpha) {
          const values = alpha.array, count = Math.min(alpha.count, points.geometry.drawRange.count);
          for (let i = 0; i < count && !lit; i++) if (values[i * alpha.itemSize]! > 0) lit = true;
        }
        if (hidden.has(points)) {
          if (lit) { points.visible = true; hidden.delete(points); } else skipped++;
        } else if (!lit && points.visible) { points.visible = false; hidden.add(points); skipped++; }
      }
      return skipped;
    },
    dispose() {
      for (const points of hidden) points.visible = true;
      hidden.clear(); pools = [];
    },
  };
}
