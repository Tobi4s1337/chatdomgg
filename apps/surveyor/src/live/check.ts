import { existsSync, readdirSync } from 'node:fs';
import type { AtlasManifest } from '@chatdom/shared';
import { liveRoot, readLiveManifest, readLiveState, verifyFrame } from './store';
import { listPreviews, loadLiveTarget } from './target';

export interface LiveCheck {
  lines: string[];
  problems: string[];
}

/**
 * Verifies every published live frame against the land it claims: alignment recomputed from the preview itself,
 * every asset's length and hash, valid codes, one start entry per live holding, canonical dabs in known realms, no
 * frame dated after its publication and no frame for a land this service no longer keeps.
 */
export async function checkLive(dataDir: string): Promise<LiveCheck> {
  const lines: string[] = [];
  const problems: string[] = [];
  if (!existsSync(liveRoot(dataDir))) return { lines: ['  live: no frame published yet (atlas:live has not run)'], problems };
  const previews = new Set(listPreviews(dataDir));
  for (const name of readdirSync(liveRoot(dataDir))) {
    if (!name.startsWith('pv-')) continue;
    if (!previews.has(name)) problems.push(`live/${name}: a frame for a preview this service no longer keeps`);
  }
  try {
    readLiveState(dataDir);
  } catch (error) {
    problems.push(`live/state.json: ${(error as Error).message.slice(0, 160)}`);
  }
  for (const id of previews) {
    let manifest: AtlasManifest | null;
    try {
      manifest = readLiveManifest(dataDir, id);
    } catch (error) {
      problems.push(`live/${id}/manifest.json: ${(error as Error).message.slice(0, 160)}`);
      continue;
    }
    if (!manifest) continue;
    try {
      const target = await loadLiveTarget(dataDir, id);
      await verifyFrame(dataDir, id, manifest, target.alignment);
      if (manifest.coverage !== 'complete-sweep') throw new Error('a partial frame is published');
      if (manifest.realmCount !== target.world.realms.length) throw new Error('realm count differs from its land');
      const live = manifest.alignment.settlerCount;
      const dabs = manifest.dabs.count;
      lines.push(`  live ${id}: ${manifest.live.path.split('/')[4]} observed ${new Date(manifest.evidence.asOf).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${live.toLocaleString('en-US')} holdings aligned · ${dabs.toLocaleString('en-US')} dabs`);
    } catch (error) {
      problems.push(`live/${id}: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  return { lines, problems };
}
