import { decodeEmoteBytes } from '../../../genesis-emotes/deps';
import { derivativeRasterHash, type ApprovedEmoteDerivative, type EmoteUse } from '../../../genesis-emotes/derivatives';
import { PINKKITTY_EMOTE_SOURCES } from './sources';

export { PINKKITTY_EMOTE_SOURCES } from './sources';

/** PinkKittyRose's full decimal broadcaster ID. */
export const PINKKITTY_BROADCASTER = '4363967';

/**
 * One checked derivative per use, and each emote checked for that use only: the heart for the market statue, the
 * rose for the stained glass, the spin for the weathervane. `assetHash` is the derivative raster's own identity
 * (`derivativeRasterHash`), pinned here and re-proved by the tests. The approval IDs name the record in CHECKS.md:
 * the lane's visual check at the carved scale. They are references, not the streamer's confirmation, which
 * Genesis still asks for live before any statue is founded (Safety.md, emotes as voxels).
 */
export const PINKKITTY_EMOTE_CHECKS = [
  { emoteId: '306925729', use: 'statue', approvalId: 'pinkkittyrose.gp10.statue.heart.1', assetHash: '42899dc29ba4af5f258fc3d153e3dd39a05033b6aaa79bb91ded170943a14416' },
  { emoteId: '307470781', use: 'stained-glass', approvalId: 'pinkkittyrose.gp10.glass.ohoho.1', assetHash: 'accb4b050a9524eb5607d9b2c03ec0c0c9493db6044725d428fe6976eba60b20' },
  { emoteId: 'emotesv2_90d764d9991b44bea9530235fd092df8', use: 'weathervane', approvalId: 'pinkkittyrose.gp10.vane.topspin.1', assetHash: '8198b52b17ccddf20c4b0cdd1f2a7c5282374b1c55597cfe41167bbfcdadf2ab' },
] as const satisfies readonly { emoteId: string; use: EmoteUse; approvalId: string; assetHash: string }[];

/** The `approvedEmotes` facts entries, in the frozen `ChannelGenesisFacts` shape. */
export function pinkKittyApprovedEmotes() {
  return PINKKITTY_EMOTE_CHECKS.map(check => ({
    emoteId: check.emoteId, broadcasterId: PINKKITTY_BROADCASTER,
    asset: { assetHash: check.assetHash, approvalId: check.approvalId },
    allowedUses: [check.use],
  }));
}

const decodeBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));
let decoded: Promise<ApprovedEmoteDerivative[]> | undefined;

/**
 * The three derivatives through the production PNG decoder, once. A raster whose hash no longer matches its
 * check is refused here rather than carved: the check covered those exact pixels.
 */
export function loadPinkKittyEmoteDerivatives(): Promise<ApprovedEmoteDerivative[]> {
  decoded ??= Promise.all(PINKKITTY_EMOTE_CHECKS.map(async check => {
    const source = PINKKITTY_EMOTE_SOURCES.find(item => item.emoteId === check.emoteId && item.use === check.use);
    if (!source) throw new Error(`No source rendition for ${check.emoteId}.`);
    const raster = await decodeEmoteBytes(decodeBase64(source.png), 'png');
    if (derivativeRasterHash(raster) !== check.assetHash) throw new Error(`The ${check.use} derivative of ${source.name} no longer matches its check.`);
    return { emoteId: check.emoteId, broadcasterId: PINKKITTY_BROADCASTER, use: check.use, asset: { assetHash: check.assetHash, approvalId: check.approvalId },
      origin: 'live' as const, rendition: 'png' as const, raster };
  }));
  return decoded;
}
