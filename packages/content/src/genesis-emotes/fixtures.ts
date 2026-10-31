import { decodeEmoteBytes, toadWaveGifBytes, type DecodedEmote } from './deps';
import { derivativeRasterHash, EMOTE_USES, type ApprovedEmoteDerivative, type EmoteUse } from './derivatives';

/**
 * SIMULATED. A rehearsal channel that does not exist, with one emote that belongs to no one: "toadWave", the
 * original eight-frame animation drawn for the emote compiler's own tests, decoded here from its real GIF bytes by
 * the production decoder. It shows the craft without impersonating any channel. Every bench view and image of it
 * carries the SIMULATED chip.
 */
export const SIMULATED_BROADCASTER = '900000001';
export const SIMULATED_EMOTE_ID = 'simulated-toadwave';
export const SIMULATED_APPROVAL_ID = 'simulated-approval-toadwave';

let decoded: Promise<DecodedEmote> | null = null;
/** The toadWave GIF through the production decoder, once. */
export function simulatedToadRaster(): Promise<DecodedEmote> {
  decoded ??= decodeEmoteBytes(toadWaveGifBytes(), 'gif');
  return decoded;
}

/** Channel-genesis facts for the simulated channel, in the frozen `ChannelGenesisFacts` shape. */
export function simulatedFacts(assetHash: string, uses: readonly EmoteUse[]) {
  return {
    version: 1 as const,
    broadcasterId: SIMULATED_BROADCASTER,
    evidence: { kind: 'simulated' as const, sourceId: 'genesis-emote-art-bench', asOf: 1793404800000, label: 'SIMULATED' as const },
    audience: { averageViewers: 120, followers: null, windowHours: 720 },
    categories: [{ categoryId: '27284', name: 'Retro', observedMinutes: 300 }],
    profileColours: [],
    approvedEmotes: uses.length ? [{ emoteId: SIMULATED_EMOTE_ID, broadcasterId: SIMULATED_BROADCASTER, asset: { assetHash, approvalId: SIMULATED_APPROVAL_ID }, allowedUses: [...uses] }] : [],
    approvedDescription: null,
    oldestFollowYear: null,
  };
}

/** One derivative per approved use, as main's facts adapter would supply them for the simulated channel. */
export function simulatedDerivatives(raster: DecodedEmote, uses: readonly EmoteUse[] = EMOTE_USES): ApprovedEmoteDerivative[] {
  const assetHash = derivativeRasterHash(raster);
  return uses.map(use => ({
    emoteId: SIMULATED_EMOTE_ID, broadcasterId: SIMULATED_BROADCASTER, use,
    asset: { assetHash, approvalId: SIMULATED_APPROVAL_ID }, origin: 'simulated', rendition: 'gif', raster,
  }));
}

/** The whole simulated input: facts approving the given uses, and their derivatives. */
export async function simulatedEmoteArtInput(uses: readonly EmoteUse[] = EMOTE_USES) {
  const raster = await simulatedToadRaster();
  return { facts: simulatedFacts(derivativeRasterHash(raster), uses), derivatives: simulatedDerivatives(raster, uses), raster };
}
