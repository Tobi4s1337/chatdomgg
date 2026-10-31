# Chatdom: guide for agents

Chatdom (chatdom.gg) gives every Twitch channel a persistent voxel kingdom that its chat lives in. The streamer
rules it, every viewer is a citizen with a home, everything that happens on Twitch happens in the world, and Codex
works inside it under fixed rules (Genesis, the Forge, the Voice of the Realm).

**The goal:** the most awesome Chatdom we can build, the whole vision, at the quality bar. We're launching it for
real, so build it to be experienced by real streamers and their chat, not to be shown once.

**Build the real thing.** Don't plan in phases, MVPs or "later" versions, and don't cut or shrink scope because
something seems like a lot of work. There is no timeline for you to manage. Plan the whole thing, then build what
the brief asks for, as well as it can be built. Tobias decides what comes next.

## The vision is the source of truth

Read `chatdom/ChatDom.md` before anything else. Every file below has a **"Decided"** list, and that list
overrides the body above it. When files disagree, ChatDom.md wins, and after that the newer change-log line wins.
Use `$chatdom-vision` when you need the map or the founder's decisions.

| File | Answers |
|---|---|
| `chatdom/ChatDom.md` | What Chatdom is: the heart, 15 principles, people, world, money lines, words |
| `chatdom/Quality.md` | The quality bar, the slop list, device targets |
| `chatdom/Artstyle-Soul-Feel.md` | The look and feel: world, characters, interiors, UI, Atlas |
| `chatdom/World-Tree.md` | The grammar of beings, things, places, acts, moments, time and memory |
| `chatdom/Twitch.md` | Every Twitch surface both ways, the Chatdom panel, Bits, channel points |
| `chatdom/Atlas.md` | The map of Twitch, and entering a kingdom from it |
| `chatdom/Monarch.md` | The streamer's side: Genesis, the throne, how Chatdom sits in a stream |
| `chatdom/Safety.md` | What people may make: judges, refusals, coals and anvils |
| `chatdom/Tech.md` | Architecture, stack, repo layout (§17), build approach (§18) |
| `chatdom/Moments.md` | The signature moments: Genesis, the citizen card, the Forge ritual, the tavern, the campfire, the Raid Gate, emotes everywhere, spectacles, seasons, making it yours |

The files cite research and earlier design docs (`docs/…`) that are not in this repo. You don't need them: the
ChatDom file itself states what was decided.

These files are a **vision, not a blueprint**. Stay true to the decisions and to the feel. You own the how. Be
ambitious. If you find a better way, take it and write down why: in the spec's Decisions section, or in
`work/DECISIONS.md` for anything cross-cutting.

Older prototypes, built before this repo, sit read-only at `/root/chatdomgg/prototyping/kingdoms/`.
`f-lanternmere` has the event-sourced core, the night look, the Forge grammar and the director camera; `e-atlas`
and `g-atlas-live` have the Atlas; `d-voxel-diorama` has the build editor. Learn from them and re-implement here.
Never copy them in wholesale: everything in this repo is built in this repo.

## Repo layout

This is the target from `chatdom/Tech.md` §17. Create the folders as the work needs them. Use one pnpm
workspace, TypeScript everywhere, and Vite plus Vitest, with Playwright for checks.

```
apps/web      the client: kingdom, build mode, tavern, throne, stream view, Atlas (Solid + three.js engine)
apps/panel    the Chatdom panel, a Twitch Extension
apps/realm    Colyseus rooms          apps/api      sign-in, sessions, REST
apps/herald   Twitch ingest and actions   apps/codex  the spell runtime (Forge, Genesis, Voice)
apps/studio   wire recorder, replay renderer, editor
packages/     world (events, reducer, rng, beats) · shared (frozen contracts) · voxel · forge · render · ui
              · audio · twitch · content (palettes, style kits, props, homes) · testing
work/         how the build is organised (see below)
```

## How we work

- **Main thread.** One Codex thread, `chatdom-main`, holds the build. It plans, freezes contracts, builds the
  core, judges integration candidates and commits. Tobias steers it. Its messages are direct. Treat them as the brief, and
  push back when something is wrong.
- **`work/`** is the build's memory: `work/PLAN.md` (the build map), `work/DECISIONS.md`,
  `work/specs/<nn>-<slug>.md` (contracts), `work/lanes/<lane>/PRD.md` with `progress.txt`, and
  `work/reviews/`, `work/references/<slug>.md` (what we learned from open source). Every turn should make sense
  from these files alone. Context gets compacted between turns, so before a turn ends, write down in `work/`
  whatever you'd need to pick up again: decisions, what's half-done, what's next.
- **Hand off generously.** This thread's own turns are for what only it can do: the plan, the contracts, the
  core systems, integration, merges and review. Everything that can be written down goes to the team as a spec
  and a PRD: a feature on a frozen contract, a UI surface, a batch of content, a test suite, a polish pass. Small
  lanes (3–6 tasks) are fine, and several run at once. When a contract freezes, write the lane specs that build
  on it in the same turn. Once a lane is handed off, don't build it yourself or with sub-agents; review and merge
  it.
- **Lanes.** Anything that can be built on its own runs as a lane. Examples: the Atlas, the panel, Twitch
  ingest, the content library, replays and capture. A lane is a worker in a git worktree on the branch
  `lane/<name>`. It owns one folder scope and follows its PRD Ralph-style: one task at a time, tick the box, one
  progress line, commit on the lane branch. `chatdom-main` writes the spec and the PRD (`$write-spec`), the team
  starts the worker. Main merges reviewed lane work every turn, one branch at a time, with a short look and focused checks; no
  announcement or additional permission is needed. An integrator candidate may still collect reviewed work,
  but is not a gate. Merge clean work promptly; send the lane one concrete missing visual detail as its next task.
  Lane workers follow `$ralph-lane`.
- **Contracts first.** `packages/shared` (types, schemas, protocol messages, budgets) changes only in
  `chatdom-main`, and before the lanes that depend on it. A lane that needs a contract change writes `needs:` in
  its progress line and keeps going on something else.
- **Sub-agents: use them a lot.** Inside a turn, fan out work that parallelises and belongs to what you're doing
  right now (recon, tests, screenshots, the pieces of the system you're building). Volume work that can wait for
  a spec goes to a lane. Always say the model and the
  effort, keep write sets disjoint (one shared checkout), and review every result yourself. Sub-agents never run
  git. Pinned roles live in `.codex/agents/`.
- **Learn from the best.** Where someone has already built a part beautifully in the open (water, sky and weather,
  voxel meshing and lighting, crowds, netcode, maps, UI motion), find it and take it apart with sub-agents before
  you write the spec. Write what we take into `work/references/` and cite it in the spec (`$study-reference`).
  Adapt code with credit when the license allows; when it doesn't, write our own.

| Model | Use it for | Effort |
|---|---|---|
| `gpt-6-astra` | The things we have to nail: the core architecture (voxel world engine, world model and simulation, avatar and character builder, build mode, Forge grammar, Genesis, realtime, `packages/shared`) and adversarial review. It is expensive, so spend it on what decides how good Chatdom can be | `xhigh` to design or build a core system, `high` for specs and reviews |
| `gpt-6.1-sol` | Features and integration that need judgement (the main thread's default) | `high`; `xhigh` for realtime, replay and performance; `medium` for routine wiring |
| `gpt-6.1-terra` | The workhorse: fan it out wide. Voxel items, props, homes and wardrobe pieces, materials, shaders, VFX, UI polish, tests, Playwright flows, screenshot review | `high` for anything judged by looking, `xhigh` for hero pieces, `medium` for tests and sweeps |
| `gpt-6-luna` | Recon, summaries, mechanical sweeps, log triage, near-zero-judgement chores | `low` or `medium` |

Use `max` effort only for a problem that has already beaten `xhigh`. Don't use `ultra`.

## Done means demonstrated

- `pnpm verify` runs typecheck, lint, tests and build, then takes the screenshots. Keep it green on `main`.
- **Look at it.** Visual work is done only once you have looked at screenshots with `view_image` at the right
  sizes: 1440×900 and 390×844 for the web, 1920×1080 for the stream view, 318×496 for the panel. See `$look`.
  Judge them against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`, and fix what looks cheap.
- Shipped paths contain no placeholders, lorem, `TODO` stubs or fake success. Simulated data is labelled
  SIMULATED wherever a person can see it.
- End every turn with a short evidence block: commits, what you verified and how, screenshot paths, and what you
  doubt.

## Git

- `main` is the integration branch. Commit every green, coherent step as a small commit with a conventional
  message (`feat(web): …`, `fix(realm): …`). Use the body for the decisions. Author and committer come from
  the repo config. Leave them alone.
- Push `main` to `origin` (private repo) after every green milestone or merge: `git push origin main`. Never
  force-push or rewrite pushed history. Lane branches stay local.
- Main takes reviewed lane commits without waiting for an announcement, one branch at a time, resolves
  composition conflicts and keeps focused checks green. A ready `lane/integrator` candidate can also enter main.
  Do not repeat deep lane reviews or hold clean work for a missing polish detail; send that detail back as the next task.
  Sub-agents never run git; lane workers commit only their lane.

## Environment

- Linux server with no GPU. Headless Chrome renders WebGL through SwiftShader: screenshots are fine, fps numbers
  mean nothing. Real-GPU checks happen on Tobias's machine. When you need one (frame timing, the real look of
  light and post-processing), ask for it in your evidence block: the path, the sizes and what to measure. Serve
  the build on port 5190 (`vite preview --port 5190 --strictPort`; 5191 and 5192 for realm and api) so it can be
  opened there.
- Available: Node 22, pnpm 10, Playwright 1.64 with Chrome, ffmpeg, sqlite3, uv. Docker is not reachable from
  the sandbox. If you need infrastructure (Postgres, a public URL, a tunnel), ask for it in your evidence block
  and the team will provide it. Previews are published under `*.chatdom.io` by the team.
- Twitch credentials: `~/.config/chatdom/atlas.env` (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
  `EVENTSUB_SECRET`). Load them in code or with `node --env-file`. Never print, copy or commit them. Use
  `$twitch-dev` first for anything Twitch.
- Live Twitch data for the Atlas is collected by the Surveyor at
  `https://twitch-demo.saartech.de/atlas/api/` (`/status` describes it).
- Research: the built-in web search, plus the Exa MCP for deeper crawling and code context. Clone reference
  repos to `/tmp/chatdom-refs/`, never inside the repo.
- Images: the built-in `image_gen` tool, through `$chatdom-art`, for paintings, interiors and UI art. Never use
  it for voxel models, fonts or icons. The Replicate MCP is the fallback.
- This host runs other production services. Never touch containers, ports, files or processes you did not
  create. Run dev servers on ports 5170–5199 and write down which.

## Hard rules

- No production deploys and no DNS, Traefik or other server configuration unless the brief says so.
- No secrets in the repo or in output. `.env*` stays ignored.
- Twitch: reading public data and the chat of any live channel through the API is fine. Writes (raids,
  predictions, polls, chat messages) go only to Tobias's channel, twitch.tv/tobi4s_. For development and tests,
  simulate freely (the Twitch CLI, recorded payloads, a simulated crowd), labelled in any UI. Never post to real
  Twitch with fake accounts; a simulated crowd lives only inside Chatdom.
- Avatars are always real people. Townsfolk are only a few keepers of places (`chatdom/World-Tree.md`).
