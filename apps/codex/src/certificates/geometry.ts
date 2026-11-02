import { createHash } from 'node:crypto';
import { assembleForge, createNativeForgeHost, findForgeSockets, forgeStyleKit } from '@chatdom/forge';
import { forgeCertificateDraft, forgeCertificateTiles, type ForgeCertificateFamily } from './protocol';

const cache = new Map<string, Map<string, string>>();
/**
 * Digest of every certification tile exactly as the blind sheet drew it. A certificate only vouches for the
 * geometry that was tested: if a motif is re-authored, its stored digest no longer matches and it is uncertified.
 */
export function forgeCertificateGeometry(family: ForgeCertificateFamily, revision: number): Map<string, string> {
  const key = `${family}@${revision}`, cached = cache.get(key);
  if (cached) return cached;
  const home = createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier: 'house', style: family, variant: 0 }).blueprint;
  const kit = forgeStyleKit(family, revision), sockets = findForgeSockets(home, 'street-home', revision), digests = new Map<string, string>();
  for (const tile of forgeCertificateTiles()) {
    const socket = sockets.find(socket => socket.kind === tile.kind);
    if (!socket) continue;
    const { blueprint } = assembleForge(forgeCertificateDraft(tile).plan, kit, socket);
    digests.set(`${tile.motif}/${tile.finish}`, createHash('sha256').update(JSON.stringify(blueprint.boxes)).digest('hex').slice(0, 16));
  }
  cache.set(key, digests);
  return digests;
}
