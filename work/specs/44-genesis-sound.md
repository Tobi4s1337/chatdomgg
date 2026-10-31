# Spec 44: Sound of three landscapes · status: frozen 2026-10-31

Vision: `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/World-Tree.md`, `chatdom/Moments.md`.

## What and why
Make coast, river and mountain feel inhabited by wind, water and place, with weather and time changing their texture. The bed should be rich enough for a stream but leave room for the game, voices and Chatdom actions.

## Rules
1. Consume recipe `soul.soundscape`, `soul.weatherSeedKey`, `soul.clock` and selected landscape. Soundscape biome and selected physical landscape are separate: use both explicitly, with river/mountain/coast foreground appropriate to the selected land, no new recipe enum.
2. Reuse the existing audio engine and mix facilities through a local adapter; no context before gesture, honour mute/volume and disposal. Provide deterministic seeded variation that avoids immediate repeats, appropriate place cues, weather/time layers and spatial intent. Main mounts the adapter; do not change audio engine or exports.
3. Use original procedural sound and/or legally suitable CC0/permissive samples. Place source, author, license, URL and modifications in a lane-local THIRD_PARTY file, including any attribution conditions. Main consolidates these entries into the repository-root `THIRD_PARTY.md` during integration; the source is not shipped without that credit. No unlicensed audio or implied rights. Offline renders and focused tests cover determinism, nonrepeat, mute/disposal, transitions and bounded levels; listen to a representative stream/game mix and document method and findings.

## Current state and contracts
`work/specs/39-channel-genesis.md` and `packages/world/src/genesis/contracts.ts` freeze the local `@chatdom/world/genesis` recipe. Consume a `DeepReadonly<ChannelKingdomRecipe>` and the explicitly selected member of `recipe.landscapes`; the recommendation is not the selection. Adapt existing content, materials and rendering/audio facilities. This lane creates a local adapter and its own fixtures; main owns package exports, dependency wiring, composition, terrain, publication, provider approval, adoption and Atlas. Do not change `packages/shared` or pretend an anchor proves ground or access. If an actual integration port is missing, record `needs:` in progress with its precise shape; continue independent asset work.

The three composition targets are The_AGGman (63920635, coastal hamlet), PinkKittyRose (4363967, river town), MashaD4 (154972160, mountain city), using spec 39's 30 October observed snapshot. Categories are artistic inputs, not community claims. The original Atlas fixture has no profile metadata. Main’s enriched public metadata in `apps/web/src/genesis/channels.ts` now supplies profile-image palette proposals and current category/tags; the read-only source cache is `shots/genesis/source-cache/`. All three channels have source emotes, badges and descriptions. Checked emote/lore derivatives are still pending. Use actual palette targets through kit snapping; never invent an approved channel asset or mistake a source download for a checked derivative. Testbench inputs and any simulated derivative are visibly labelled SIMULATED, including screenshots. Do not present a mock as approved channel art. Internal source references are not public scene data.

## Acceptance and quality
For sound, replace visual capture with offline renders and a documented listening check; visual requirements apply only if this lane itself makes a visual change.

Use the existing palette and style kits; crafted, warm toy-diorama detail, clear silhouette, believable scale and grounded contact. Assets must be deterministic and fit existing schema/material/budget constraints. Run focused tests for the lane, `pnpm typecheck`, and relevant validator where applicable; document exact executed commands and results in progress. For each visual change, capture and inspect one 1920×1080 stream-first shot of the most representative affected composition; record its path and finding. Until main supplies the composition mount, use a labelled SIMULATED lane-local content bench: that can complete the independent asset task, but not the final in-kingdom integration task. Record the precise missing mount as `needs:`. Do not wait to author independent content, and do not claim that a bench proves integration. Do not run a screenshot matrix. SwiftShader is not performance proof.

## References
`packages/content/README.md` for blueprint lattice, materials, validation and render; `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/World-Tree.md`, and `chatdom/Moments.md` for the visual and social bar. `work/specs/39-channel-genesis.md` is authoritative for the API and real-target provenance.

## Decisions
2026-10-31: Local adapter consumes the recipe and selected landscape, without changing frozen contracts. Root integrates and validates external assets. Show simulated inputs honestly; absent approved channel material stays absent. Review the first three compositions before expanding breadth.

## Scope
Write only `packages/audio/src/genesis-biomes/**` and this lane’s PRD/progress. All other paths are read-only. Lane-local tests, fixtures and credits belong inside that scope. Existing assets, engines, shaders, shared contracts, package manifests and consumers are main-owned.

## Not now
No terrain, adoption, provider approvals, Atlas integration, package export changes, live channel claims, or additional landscape breadth.
