// Written by apps/panel/scripts/capture-fixture.mjs. Do not edit by hand: re-render instead.
// These stills come from our kingdom renderer showing the SIMULATED Willowmere night.
export const FIXTURE_PROVENANCE = {
  "origin": "simulated",
  "capturedOn": "2026-10-30",
  "sourceRevision": "cc46a15",
  "pictures": {
    "kingdom": {
      "file": "willowmere-kingdom.webp",
      "width": 640,
      "height": 400,
      "bytes": 25402,
      "alt": "Willowmere at dusk: warm windows in the streets below the castle",
      "render": {
        "route": "/?source=simulated&seed=willowmere&tier=town&hour=20.7&time=30&camera=hero",
        "seed": "willowmere",
        "tier": "town",
        "hour": 20.7,
        "time": 30,
        "camera": "hero",
        "renderer": "apps/web/src/kingdom/scene.ts",
        "presence": "simulated"
      }
    },
    "portrait": {
      "file": "willowmere-portrait.webp",
      "width": 600,
      "height": 760,
      "bytes": 25294,
      "alt": "Willowmere at dusk, the castle above the lit streets",
      "render": {
        "route": "/?source=simulated&seed=willowmere&tier=town&hour=20.7&time=30&camera=hero",
        "seed": "willowmere",
        "tier": "town",
        "hour": 20.7,
        "time": 30,
        "camera": "hero",
        "renderer": "apps/web/src/kingdom/scene.ts",
        "presence": "simulated"
      }
    },
    "window": {
      "file": "willowmere-window.webp",
      "width": 560,
      "height": 360,
      "bytes": 14340,
      "alt": "Close to one home in Willowmere, its window lit at dusk",
      "render": {
        "route": "/?source=simulated&seed=willowmere&tier=town&hour=20.4&time=30&camera=window",
        "seed": "willowmere",
        "tier": "town",
        "hour": 20.4,
        "time": 30,
        "camera": "window",
        "renderer": "apps/web/src/kingdom/scene.ts",
        "presence": "simulated"
      }
    }
  }
} as const;
