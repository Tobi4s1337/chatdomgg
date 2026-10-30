# Chatdom

Every Twitch channel gets a persistent voxel kingdom that its chat lives in. The streamer rules it, every viewer is
a citizen with a home, everything that happens on Twitch happens in the world, and Codex works inside it under fixed
rules: it founds the kingdom, forges what chat imagines, and gives the realm its voice.

| Path | What |
|---|---|
| `chatdom/` | The vision: `ChatDom.md` first, then quality, art, world, Twitch, Atlas, monarch, safety, tech, and the signature moments |
| `AGENTS.md` | How to work in this repo |
| `.agents/skills/` | Skills for the agents that build Chatdom |
| `.codex/` | Codex project config and sub-agent roles |
| `work/` | The build map, decisions, specs, lane task lists and reviews |

Start the build with [the whole-project map](work/PLAN.md). The workspace scaffold and first shared contracts are in place;
Atlas is the first independent lane, with the voxel kingdom at dusk next in the main thread.

## Local development

Use Node 22.23.4 and pnpm 10.17.0 (`.node-version` and `packageManager`).

- `pnpm install --frozen-lockfile`
- `pnpm verify` — typecheck, lint, Vitest, all workspace builds, then Chrome screenshots.
- `pnpm dev` — web on port 5170.
- `pnpm --filter @chatdom/web preview` — built preview on port 5190.
- `pnpm shots` — starts its own temporary preview on 5189 and captures the four standard viewports.
- `pnpm shots --base-url http://127.0.0.1:5190 --area atlas` — Atlas checks once that lane is integrated.
- `pnpm check:services` — reads local `.env`, checks Postgres 18, Valkey and Surveyor without writes.

Chrome is required (`pnpm exec playwright install chrome` on a fresh machine). `shots/` is regenerated and ignored.
The initial web/stream/panel pages are labelled development benches for verifying the scaffold; they do not
implement the kingdom, OBS client or Twitch Extension. The actual Atlas module mounts from
`apps/web/src/atlas/index.tsx` at `/map` when present. It owns its ready signal and `data-chatdom-atlas` root.
The lane's `/map-data` service uses port 5193 through the Vite dev/preview proxy.

Secrets belong in ignored `.env`; only variable names are documented: `DATABASE_URL`, `VALKEY_URL`, `SURVEYOR_URL`.
Each worktree needs its own locally supplied environment file. Never copy secrets into the lane brief or commit.
