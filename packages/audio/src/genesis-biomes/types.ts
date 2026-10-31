import type {
  ChannelKingdomRecipe, DeepReadonly, GenesisBiome, GenesisLandmark, GenesisLandscape,
} from '../../../world/src/genesis/contracts';

export type { ChannelKingdomRecipe, DeepReadonly, GenesisBiome, GenesisLandmark, GenesisLandscape };
export type GenesisRecipe = DeepReadonly<ChannelKingdomRecipe>;
export type LandscapeCharacter = GenesisLandscape['character'];
export type Vec3 = readonly [number, number, number];
export type XZ = readonly [number, number];

/**
 * The weather the land is having, every field 0..1. By default it comes from `soul.weatherSeedKey` and the realm
 * clock (`genesisWeatherAt`), so the sound and any picture that reads the same function agree; a host that runs its
 * own weather passes it instead.
 */
export interface GenesisWeather {
  /** Mean wind strength. Gusts ride on top of it. */
  wind: number;
  /** Rain reaching the ground (0 when it falls as snow). */
  rain: number;
  /** Snow falling. Snow muffles the world rather than adding noise. */
  snow: number;
  /** Thunderstorm activity: thunder, a heavier sea, harder gusts. */
  storm: number;
  /** Mist or sea fog: highs softened, birds quieter, the bell buoy speaks. */
  fog: number;
  /** How wet everything still is: rain that stopped keeps the eaves dripping for a while. */
  wet: number;
}

export type GenesisWeatherKind = 'clear' | 'breezy' | 'windy' | 'mist' | 'drizzle' | 'rain' | 'storm' | 'snow';

/** Listener in kingdom metres (+Y up) and the listener's right-hand direction, as the camera reports it. */
export interface GenesisListener { position: Vec3; right: Vec3 }

/** One rendered frame, from the host's render loop. */
export interface GenesisSoundFrame {
  /** The realm clock (`soul.clock: 'realm-time'`) in milliseconds. Drives weather and every seeded event. */
  realmMs: number;
  /** The hour of day the picture shows, 0..24 (wraps). */
  hour: number;
  /** Where the ear is. Without one, the ear stands in the plaza at head height. */
  listener?: GenesisListener;
  /** The host's own weather, when it has one. Omitted fields fall back to the seeded weather. */
  weather?: Partial<GenesisWeather>;
}

/**
 * `kingdom`: someone exploring the world, the full landscape. `stream`: under a streamer's voice and a game, the bed
 * sits 5 dB lower, the speech band is carved further and the most talkative calls are sparser.
 */
export type GenesisSoundProfile = 'kingdom' | 'stream';

export interface GenesisSoundMix {
  muted: boolean;
  /** 0..1, gain is volume² (the kingdom's law). On the kingdom host leave it at 1: the master already applies it. */
  volume: number;
  profile?: GenesisSoundProfile;
}
