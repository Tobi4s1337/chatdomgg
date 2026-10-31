/** Public Twitch metadata, read-only capture. Palette proposals are pixel-derived from profile images.
 * Raw descriptions and images remain in the ignored source cache, outside the pure recipe and public scene.
 */
export const PROFILE_CAPTURED_AT = "2026-10-31T13:07:42.905Z";
export const GENESIS_CHANNELS = [
  {
    "id": "63920635",
    "name": "The_AGGman",
    "login": "the_aggman",
    "palette": [
      "#C91709",
      "#F8AE04",
      "#FE9E79",
      "#075E86"
    ],
    "profileImageHash": "d3f3b9bf233e41c9e24c8672bc8e71369d6415a32296b0d32af779d15f318f48",
    "descriptionSourceHash": "db3e0a14ffd01afde67779f12fb015da7cd59d8cd3b74de5f50d315cfc784141",
    "descriptionAvailable": true,
    "currentCategory": "Hell is Us",
    "tags": [
      "StrongLanguage",
      "Metalhead",
      "DnDnerd",
      "English",
      "CatDad",
      "Tattoos",
      "olderthangoogle",
      "genAIoff"
    ],
    "emoteCount": 33,
    "badgeSetCount": 2
  },
  {
    "id": "4363967",
    "name": "PinkKittyRose",
    "login": "pinkkittyrose",
    "palette": [
      "#8753DA",
      "#651E8C",
      "#74604C",
      "#4E125E"
    ],
    "profileImageHash": "02318313cb0489185860d48d3e3bf1988682be283f23fd3806ff16d720a58638",
    "descriptionSourceHash": "f98574e8da1232b38aedf6b6f732fa75bb990527730572602b00666cb200f466",
    "descriptionAvailable": true,
    "currentCategory": "Retro",
    "tags": [
      "English",
      "Canada",
      "NoBackseating",
      "NoSpoilers",
      "Randomizer",
      "Vtuber"
    ],
    "emoteCount": 50,
    "badgeSetCount": 2
  },
  {
    "id": "154972160",
    "name": "MashaD4",
    "login": "mashad4",
    "palette": [
      "#514A98",
      "#87746F",
      "#6E5A65",
      "#3945D8"
    ],
    "profileImageHash": "6822b51c264421287000fbae58c9ea66b8c06f2c24deaca3b2fa86a92ec77d2b",
    "descriptionSourceHash": "bb2bfd9f09cb0ca161dfe8248f33198c458d0cae169011bd7e16c570ad3e1be9",
    "descriptionAvailable": true,
    "currentCategory": "Just Chatting",
    "tags": [
      "funny",
      "English",
      "chess",
      "Russian",
      "TCG",
      "hype",
      "musicstream",
      "BestMusicTaste",
      "Rock",
      "Groovy"
    ],
    "emoteCount": 107,
    "badgeSetCount": 4
  }
] as const;
export const genesisPreviewPath = (id: string): string | null =>
  GENESIS_CHANNELS.some(channel => channel.id === id) ? `/kingdom/${id}` : null;
