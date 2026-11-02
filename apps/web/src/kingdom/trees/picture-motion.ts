/* global Worker:readonly */
import { createPictureTree, TREE_SPECIES, TREE_STYLES, TREE_VARIANTS, type CanopyMotion, type StyleFamily, type TreeSpecies } from '@chatdom/content/trees';
import type { VoxelBlueprint } from '@chatdom/shared';

/**
 * An installed picture tree's wind motion (its canopy and trunk root) comes from growing that tree again, which is
 * slow enough to hold the opening's main thread for every species and variant in town. One worker grows them while
 * the ground is sampled and the meshes are made; the scene reads the same numbers from here.
 */
export interface PictureTreeRef { readonly species: TreeSpecies; readonly style: StyleFamily; readonly variant: number }
export interface PictureMotion { readonly id: string; readonly canopy: CanopyMotion; readonly root: readonly [number, number, number] }
export type PictureMotionReply = { readonly motions: readonly PictureMotion[] } | { readonly error: string };

const PICTURE_TREE = /^tree-(oak|pine|birch|willow|elder)-(hearth|tide|grove)-(\d+)$/;

/** The picture tree an installed flora blueprint is, or undefined. Mirrors the kingdom scene's own test. */
export function pictureTreeOf(blueprint: VoxelBlueprint): PictureTreeRef | undefined {
  const match = PICTURE_TREE.exec(blueprint.id);
  const species = match?.[1] as TreeSpecies | undefined, style = match?.[2] as StyleFamily | undefined, variant = Number(match?.[3]);
  return blueprint.kind === 'flora' && species && style && TREE_SPECIES.includes(species) && TREE_STYLES.includes(style)
    && blueprint.styleId === style && variant < TREE_VARIANTS[species] ? { species, style, variant } : undefined;
}

export function growPictureMotions(refs: readonly PictureTreeRef[]): PictureMotion[] {
  return refs.map(({ species, style, variant }) => { const tree = createPictureTree(species, style, variant); return { id: tree.id, canopy: tree.canopy, root: tree.root }; });
}

export function preparePictureMotions(refs: readonly PictureTreeRef[], options: { readonly signal?: AbortSignal } = {}): Promise<ReadonlyMap<string, PictureMotion>> {
  const index = (motions: readonly PictureMotion[]) => new Map(motions.map(motion => [motion.id, motion]));
  const unique = [...new Map(refs.map(ref => [`${ref.species}:${ref.style}:${ref.variant}`, ref])).values()];
  if (!unique.length) return Promise.resolve(new Map());
  if (typeof Worker === 'undefined') return Promise.resolve(index(growPictureMotions(unique)));
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./picture-motion-worker.ts', import.meta.url), { type: 'module', name: 'picture-motion' }); }
    catch (error) { reject(error); return; }
    let finished = false;
    const finish = () => { finished = true; worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finish(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<PictureMotionReply>) => {
      if (finished) return;
      if ('error' in event.data) { fail(new Error(event.data.error)); return; }
      finish(); resolve(index(event.data.motions));
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The tree motion worker failed')); };
    worker.onmessageerror = () => fail(new Error('The tree motion worker sent an unreadable reply'));
    worker.postMessage(unique);
  });
}
