import { ChannelGenesisFactsSchema } from './contracts';

/**
 * Observed input evidence, NOT founded or publication-approved kingdoms. Source: immutable Atlas import
 * obs-20261030T163224Z-8fff6dfa7def, channels.ndjson + games.ndjson + import.json. Full provenance in spec 39.
 * No current live-state claim. Missing profile metadata and follower/tenure facts stay missing.
 */
const sourceId = 'obs-20261030T163224Z-8fff6dfa7def';
const asOf = 1793377944392;
const evidenceRows = [
  { broadcasterId: '63920635', averageViewers: 16, categories: [
    { categoryId: '32399', name: 'Counter-Strike', observedMinutes: 230.9946 },
    { categoryId: '119464928', name: 'Hell is Us', observedMinutes: 201.2566 },
  ] },
  { broadcasterId: '4363967', averageViewers: 139.98, categories: [
    { categoryId: '27284', name: 'Retro', observedMinutes: 324.4682 },
  ] },
  { broadcasterId: '154972160', averageViewers: 852.12, categories: [
    { categoryId: '743', name: 'Chess', observedMinutes: 87.1052 },
  ] },
] as const;

export const OBSERVED_GENESIS_FIXTURES = evidenceRows.map(row => ChannelGenesisFactsSchema.parse({
  version: 1, broadcasterId: row.broadcasterId,
  evidence: { kind: 'observed', sourceId, asOf },
  audience: { averageViewers: row.averageViewers, followers: null, windowHours: 24.79 },
  categories: row.categories, profileColours: [], approvedEmotes: [], approvedDescription: null, oldestFollowYear: null,
}));

/** Curated choices for the requested three visual targets, NOT claims observed on Twitch or adopted land. */
export const OBSERVED_GENESIS_SHOWCASE_CHOICES = [
  { broadcasterId: '63920635', character: 'coastal-harbour' },
  { broadcasterId: '4363967', character: 'river-valley' },
  { broadcasterId: '154972160', character: 'mountain-pass' },
] as const;
