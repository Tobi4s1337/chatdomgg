import { decodeEmoteBytes } from '../../../genesis-emotes/deps';
import { derivativeRasterHash, type ApprovedEmoteDerivative, type EmoteUse } from '../../../genesis-emotes/derivatives';
import { AGGMAN_EMOTE_SOURCES } from './sources';

export { AGGMAN_EMOTE_SOURCES } from './sources';

/** The_AGGman's full decimal broadcaster ID. */
export const AGGMAN_BROADCASTER = '63920635';

/**
 * One checked derivative per use, and each emote checked for that use only: the three-headed goose for the quay
 * statue, the goose with the heart for the inn's stained glass, the strutting goose for the weathervane. `assetHash`
 * is the derivative raster's own identity (`derivativeRasterHash`), pinned here and re-proved by the tests. The
 * approval IDs name the record in CHECKS.md: the lane's visual check at the carved scale. They are references, not
 * the streamer's confirmation, which Genesis still asks for live before any statue is founded (Safety.md, emotes as
 * voxels).
 */
export const AGGMAN_EMOTE_CHECKS = [
  { emoteId: 'emotesv2_12048d0ce39f4db087ecec37bcde102b', use: 'statue', approvalId: 'the_aggman.ga10.statue.hydragoose.1', assetHash: 'b6a7eb0e15fee9829607d6d6b48459a2952b9863f3f54b768b0db94d0065d79f' },
  { emoteId: 'emotesv2_f204a49c5d204a6d8b4524c0d89be539', use: 'stained-glass', approvalId: 'the_aggman.ga10.glass.love.1', assetHash: '9d5006bae5c149472c49a07162bc772aa06d93b9218529ad6709ab8c1401041b' },
  { emoteId: 'emotesv2_03880224167d491abb427b80bb4d1fe3', use: 'weathervane', approvalId: 'the_aggman.ga10.vane.bounce.1', assetHash: '0581ae0e8aaf922cecdad6cfa922e4a02c046beb990c6e0debe245f2a9d0cec0' },
] as const satisfies readonly { emoteId: string; use: EmoteUse; approvalId: string; assetHash: string }[];

/** The `approvedEmotes` facts entries, in the frozen `ChannelGenesisFacts` shape. */
export function aggmanApprovedEmotes() {
  return AGGMAN_EMOTE_CHECKS.map(check => ({
    emoteId: check.emoteId, broadcasterId: AGGMAN_BROADCASTER,
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
export function loadAggmanEmoteDerivatives(): Promise<ApprovedEmoteDerivative[]> {
  decoded ??= Promise.all(AGGMAN_EMOTE_CHECKS.map(async check => {
    const source = AGGMAN_EMOTE_SOURCES.find(item => item.emoteId === check.emoteId && item.use === check.use);
    if (!source) throw new Error(`No source rendition for ${check.emoteId}.`);
    const raster = await decodeEmoteBytes(decodeBase64(source.png), 'png');
    if (derivativeRasterHash(raster) !== check.assetHash) throw new Error(`The ${check.use} derivative of ${source.name} no longer matches its check.`);
    return { emoteId: check.emoteId, broadcasterId: AGGMAN_BROADCASTER, use: check.use, asset: { assetHash: check.assetHash, approvalId: check.approvalId },
      origin: 'live' as const, rendition: 'png' as const, raster };
  }));
  return decoded;
}
