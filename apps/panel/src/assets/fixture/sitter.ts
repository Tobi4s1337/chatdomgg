// Written by apps/panel/src/card/sit-fixture.mjs. Do not edit by hand: sit the portrait again instead.
// The SIMULATED citizen of the panel's night, painted by our citizen portrait renderer from their saved look.
import type { WornRecord } from '../../card/worn';

export const SITTER_PORTRAIT = {
  "origin": "simulated",
  "file": "wren-portrait.webp",
  "width": 320,
  "height": 320,
  "bytes": 7266,
  "alt": "Wren Tarnwalker’s portrait: auburn braids, a rust coat with the Willowmere hood down on the shoulders and a knitted raid scarf",
  "render": {
    "renderer": "apps/web/src/avatar-builder/portrait-renderer.ts",
    "look": "apps/web/src/citizen-card/sitter.ts",
    "size": 512
  },
  "sourceRevision": "49e4684",
  "capturedOn": "2026-11-01"
} as const;

/** What the sitter wears of what their SIMULATED records allow, named as the builder names it. */
export const SITTER_WORN: readonly WornRecord[] = [
  {
    "key": "ribbons",
    "name": "Month ribbons",
    "story": "14 months subscribed",
    "piece": {
      "family": "ribbons",
      "value": {
        "months": 12
      }
    }
  },
  {
    "key": "hood",
    "name": "Tenure hood",
    "story": "Following Willowmere for 26 months",
    "piece": {
      "family": "hood",
      "value": {
        "cloth": "#2f5e4e",
        "trim": "#e3b955"
      }
    }
  },
  {
    "key": "pin:keepsake:keepsake:m8a",
    "name": "A sprig of salt lavender",
    "story": "Brindlewick-under-the-Long-Ridge-of-Seven-Lanterns, 3 Oct 2026",
    "piece": {
      "family": "pin",
      "value": {
        "kind": "keepsake",
        "id": "keepsake:m8a",
        "shape": "heater",
        "colours": [
          "#4b5a3a",
          "#efe3c0"
        ]
      }
    }
  },
  {
    "key": "scarf:sim-raid-m1",
    "name": "Raid scarf: Emberfold",
    "story": "Rode the raid to Emberfold, 30 Oct 2026",
    "piece": {
      "family": "scarf",
      "value": {
        "id": "sim-raid-m1",
        "colours": [
          "#24485a",
          "#9b2d20"
        ]
      }
    }
  }
];
