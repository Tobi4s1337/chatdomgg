import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createForgeRefusalPresentation, FORGE_MOOD_DURATION, FORGE_MOOD_LINES, FORGE_MOOD_SOOT, type ForgeMoodMotion, type ForgeRefusalBeat } from './index';

/** The slice of a host caption node the adapter is allowed to touch. */
class CaptionNode {
  textContent: string | null = 'host text left behind';
  hidden = false;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> & { removeProperty(name: string): string } = Object.assign(Object.create(null) as Record<string, string>, {
    removeProperty(this: Record<string, string>, name: string) { const value = this[name] ?? ''; delete this[name]; return value; },
  });
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
}

const ANVIL = [0, 1.45, 0] as const;
const SAMPLES = [0, 0.18, 0.3, 0.42, 0.7, 1.2, 1.6, 2.1, 2.55, 3.0, 3.4, 3.59];

function stage(motion: ForgeMoodMotion = 'full') {
  const root = new THREE.Group();
  const borrowedGeometry = new THREE.BoxGeometry(1, 1, 1), borrowedMaterial = new THREE.MeshBasicMaterial();
  const forge = new THREE.Mesh(borrowedGeometry, borrowedMaterial);
  root.add(forge);
  const disposed = { geometry: vi.spyOn(borrowedGeometry, 'dispose'), material: vi.spyOn(borrowedMaterial, 'dispose') };
  const caption = new CaptionNode();
  const mood = createForgeRefusalPresentation({ root, anvil: ANVIL, caption: caption as unknown as HTMLElement, motion });
  const group = root.children.find(child => child !== forge)!;
  const meshes = group.children as (THREE.InstancedMesh | THREE.Mesh)[];
  const [soot, embers] = meshes.filter((mesh): mesh is THREE.InstancedMesh => mesh instanceof THREE.InstancedMesh);
  return { root, forge, disposed, caption, mood, group, meshes, soot: soot!, embers: embers! };
}

const scale = new THREE.Vector3(), at = new THREE.Vector3(), matrix = new THREE.Matrix4();
/** Every visible instance as a rounded position and size: the pose the viewer would see. */
function poseOf(mesh: THREE.InstancedMesh) {
  const out: number[][] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    // Read the columns directly: decompose() reports a collapsed instance as unit scale.
    scale.setFromMatrixScale(matrix);
    at.setFromMatrixPosition(matrix);
    if (scale.x > 1e-4) out.push([i, ...at.toArray(), scale.x].map(n => Math.round(n * 1e4) / 1e4));
  }
  return out;
}
const visibleSoot = (s: ReturnType<typeof stage>) => s.group.visible ? poseOf(s.soot).length : 0;

afterEach(() => { vi.unstubAllGlobals(); });

describe('the forge mood sequence', () => {
  it('starts inert, adds one bounded group and borrows nothing it may dispose', () => {
    const s = stage();
    expect(s.root.children).toEqual([s.forge, s.group]);
    expect(s.group.visible).toBe(false);
    expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    expect(s.caption.attributes.get('aria-live')).toBe('polite');
    expect(s.meshes.length).toBeLessThanOrEqual(4);
    expect(s.soot.count).toBeLessThanOrEqual(24);
    expect(s.soot.count).toBe(FORGE_MOOD_SOOT);
    s.group.traverse(node => expect(node).not.toBeInstanceOf(THREE.Light));
    // Sampling before any beat shows nothing.
    s.mood.update(1.2);
    expect(s.group.visible).toBe(false);
    expect(s.caption.textContent).toBe('');
  });

  it('gives every variant the same movement and only its own line from the fixed pool', () => {
    for (const motion of ['full', 'reduced'] as const) {
      const runs = ([0, 1, 2] as const).map(variant => {
        const s = stage(motion), lines = new Set<string>();
        s.mood.play({ kind: 'refusal', variant });
        const frames = SAMPLES.map(t => {
          s.mood.update(t);
          if (!s.caption.hidden) lines.add(s.caption.textContent ?? '');
          return { soot: poseOf(s.soot), embers: poseOf(s.embers), opacity: s.caption.style.opacity ?? '', transform: s.caption.style.transform ?? '', hidden: s.caption.hidden };
        });
        expect([...lines]).toEqual([FORGE_MOOD_LINES[variant]]);
        return frames;
      });
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
    }
  });

  it('never queues or repeats a cough, and a seek past the end leaves nothing behind', () => {
    const s = stage();
    s.mood.play({ kind: 'refusal', variant: 1 });
    s.mood.update(1.2);
    const sulk = poseOf(s.soot);
    expect(sulk.length).toBeGreaterThan(0);
    // A second delivery while active is ignored: same line, same pose, no restart, nothing queued.
    s.mood.play({ kind: 'refusal', variant: 2 });
    s.mood.update(1.2);
    expect(poseOf(s.soot)).toEqual(sulk);
    expect(s.caption.textContent).toBe(FORGE_MOOD_LINES[1]);
    // Skipped samples land on the pose for that second; seeking back does not cough again.
    s.mood.update(3.2);
    s.mood.update(-2);
    expect(visibleSoot(s)).toBe(0);
    expect(s.caption.hidden).toBe(true);
    s.mood.update(FORGE_MOOD_DURATION + 7);
    expect(s.group.visible).toBe(false);
    expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    expect(s.caption.style.opacity).toBeUndefined();
    // The ignored delivery did not wait in line: later samples stay empty.
    for (const t of [0.5, 1.2, 2]) s.mood.update(t);
    expect(s.group.visible).toBe(false);
    expect(s.caption.textContent).toBe('');
    // The next admitted beat starts clean from zero.
    s.mood.play({ kind: 'refusal', variant: 0 });
    expect(s.group.visible).toBe(true);
    expect(visibleSoot(s)).toBe(0);
    expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    s.mood.update(0.7);
    expect(s.caption.textContent).toBe(FORGE_MOOD_LINES[0]);
  });

  it('clears on any sample that is no time at all', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1.2' as unknown as number, undefined as unknown as number]) {
      const s = stage();
      s.mood.play({ kind: 'refusal', variant: 0 });
      s.mood.update(1.2);
      s.mood.update(bad);
      expect(s.group.visible).toBe(false);
      expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    }
  });

  it('admits exactly the public refusal arm and nothing that rides along with it', () => {
    const s = stage();
    // @ts-expect-error a public beat carries no maker
    s.mood.play({ kind: 'refusal', variant: 0, maker: 'someone' });
    // @ts-expect-error a public beat carries no request
    s.mood.play({ kind: 'refusal', variant: 0, prompt: 'a wish' });
    // @ts-expect-error a public beat carries no reason
    s.mood.play({ kind: 'refusal', variant: 0, reason: 'harm' });
    // @ts-expect-error only the three pooled lines exist
    s.mood.play({ kind: 'refusal', variant: 3 });
    for (const malformed of [null, [], { kind: 'refusal' }, { kind: 'work', variant: 0 }, { kind: 'refusal', variant: '0' }]) s.mood.play(malformed as unknown as ForgeRefusalBeat);
    s.mood.update(1.2);
    expect(s.group.visible).toBe(false);
    expect(s.caption.textContent).toBe('');
    // Nothing about the beat is written onto the scene for anyone to read back.
    s.mood.play({ kind: 'refusal', variant: 2 });
    s.mood.update(1.2);
    s.group.traverse(node => expect(node.userData).toEqual({}));
    expect([...s.caption.attributes.keys()].sort()).toEqual(['aria-atomic', 'aria-live']);
  });

  it('reduced motion keeps the clock, the line and the ember dip, and nothing travels', () => {
    const full = stage('full'), still = stage('reduced');
    for (const s of [full, still]) s.mood.play({ kind: 'refusal', variant: 0 });
    const puffAt = (s: ReturnType<typeof stage>, t: number) => { s.mood.update(t); return new Map(poseOf(s.soot).filter(([i]) => i! < 20).map(([i, x, y, z]) => [i!, [x, y, z]])); };
    /** How far the cubes seen at both seconds moved between them. */
    const travel = (s: ReturnType<typeof stage>, from: number, to: number) => {
      const a = puffAt(s, from), b = puffAt(s, to);
      return [...a].filter(([i]) => b.has(i)).reduce((most, [i, p]) => Math.max(most, Math.hypot(...p.map((n, k) => n! - b.get(i)![k]!))), 0);
    };
    // The full cough flies; the reduced puff stays exactly where it appeared.
    expect(travel(full, 0.45, 1.2)).toBeGreaterThan(0.1);
    expect(puffAt(still, 0.45).size).toBeGreaterThan(10);
    expect(travel(still, 0.45, 1.2)).toBe(0);
    const emberAt = (s: ReturnType<typeof stage>, t: number) => { s.mood.update(t); return poseOf(s.embers).map(([i, x, y, z]) => [i, x, y, z]); };
    expect(emberAt(still, 0.2)).toEqual(emberAt(still, 2.7));
    expect(emberAt(full, 0.2)).not.toEqual(emberAt(full, 2.7));
    // The fire still dips: smaller embers in the sulk than before the cough.
    const size = (s: ReturnType<typeof stage>, t: number) => { s.mood.update(t); return poseOf(s.embers).reduce((sum, p) => sum + p[4]!, 0); };
    expect(size(still, 1.4)).toBeLessThan(size(still, 0.2));
    // No sigh crumbs in reduced motion.
    still.mood.update(1.7);
    expect(poseOf(still.soot).some(([i]) => i! >= 20)).toBe(false);
    // Same caption timing, no rise.
    for (const t of SAMPLES) {
      full.mood.update(t); still.mood.update(t);
      expect([still.caption.hidden, still.caption.style.opacity]).toEqual([full.caption.hidden, full.caption.style.opacity]);
      expect(still.caption.style.transform).toBeUndefined();
    }
    still.mood.update(FORGE_MOOD_DURATION);
    expect(still.group.visible).toBe(false);
  });

  it('follows the viewer setting when a beat is admitted', () => {
    const query = vi.fn((media: string) => ({ matches: media === '(prefers-reduced-motion: reduce)' }));
    vi.stubGlobal('matchMedia', query);
    const auto = stage('auto'), still = stage('reduced');
    for (const s of [auto, still]) { s.mood.play({ kind: 'refusal', variant: 0 }); s.mood.update(1.0); }
    expect(query).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(poseOf(auto.soot)).toEqual(poseOf(still.soot));
  });

  it('disposes once, removing only its own group and caption text', () => {
    const s = stage();
    s.mood.play({ kind: 'refusal', variant: 0 });
    s.mood.update(1.2);
    s.mood.dispose();
    expect(s.root.children).toEqual([s.forge]);
    expect(s.disposed.geometry).not.toHaveBeenCalled();
    expect(s.disposed.material).not.toHaveBeenCalled();
    expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    expect(s.caption.attributes.size).toBe(0);
    // Later calls do nothing, and a second dispose is harmless.
    s.mood.play({ kind: 'refusal', variant: 1 });
    s.mood.update(1.2);
    s.mood.dispose();
    expect(s.group.visible).toBe(false);
    expect(s.caption).toMatchObject({ textContent: '', hidden: true });
    expect(s.root.children).toEqual([s.forge]);
  });
});
