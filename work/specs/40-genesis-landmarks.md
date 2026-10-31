# Spec 40: Landmarks for three landscapes · status: frozen 2026-10-31

Vision: `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/World-Tree.md`, `chatdom/Moments.md`.

## What and why
Give each landscape an unmistakable authored focal point: a coastal harbour watchtower, a river landmark with a Retro-inspired civic rhythm, and a mountain civic landmark with a chess-inspired silhouette and a cathedral site. Interpret categories as visual cues only; do not copy game IP, fabricate channel history, or imply the category is the streamer's identity. Design a small, excellent family, not a catalogue of filler.

## Rules
1. Produce finished authored blueprint(s) for all three characters with strong silhouette and readable material changes; work with existing `materials.ts`, `civic`, and `places` kits, not a new renderer or palette.
2. Adapter takes recipe plus selected landscape and returns deterministic local content proposals with footprint, orientation and doorway/interaction metadata. Respect `identity.landmark` and selected `landscape.character` as distinct inputs; the three showcase choices are explicit art direction, not a new enum or a rewrite of the recipe.
3. Provide real footprint and doorway/approach geometry for main to ground and validate; do not claim an anchor is a valid placement. Reserve the city cathedral site without creating imaginary population. Usable-looking interaction affordances must be described for integration rather than faked.
4. Test determinism, palette/schema and clearance/door geometry. No runtime consumer or new shared contract.

## Current state and contracts
`work/specs/39-channel-genesis.md` and `packages/world/src/genesis/contracts.ts` freeze the local `@chatdom/world/genesis` recipe. Consume a `DeepReadonly<ChannelKingdomRecipe>` and the explicitly selected member of `recipe.landscapes`; the recommendation is not the selection. Adapt existing content, materials and rendering/audio facilities. This lane creates a local adapter and its own fixtures; main owns package exports, dependency wiring, composition, terrain, publication, provider approval, adoption and Atlas. Do not change `packages/shared` or pretend an anchor proves ground or access. If an actual integration port is missing, record `needs:` in progress with its precise shape; continue independent asset work.

The three composition targets are The_AGGman (63920635, coastal hamlet), PinkKittyRose (4363967, river town), MashaD4 (154972160, mountain city), using spec 39's 30 October observed snapshot. Categories are artistic inputs, not community claims. The original Atlas fixture has no profile metadata. Main’s enriched public metadata in `apps/web/src/genesis/channels.ts` now supplies profile-image palette proposals and current category/tags; the read-only source cache is `shots/genesis/source-cache/`. All three channels have source emotes, badges and descriptions. Checked emote/lore derivatives are still pending. Use actual palette targets through kit snapping; never invent an approved channel asset or mistake a source download for a checked derivative. Testbench inputs and any simulated derivative are visibly labelled SIMULATED, including screenshots. Do not present a mock as approved channel art. Internal source references are not public scene data.

## Acceptance and quality
Use the existing palette and style kits; crafted, warm toy-diorama detail, clear silhouette, believable scale and grounded contact. Assets must be deterministic and fit existing schema/material/budget constraints. Run focused tests for the lane, `pnpm typecheck`, and relevant validator where applicable; document exact executed commands and results in progress. For each visual change, capture and inspect one 1920×1080 stream-first shot of the most representative affected composition; record its path and finding. Until main supplies the composition mount, use a labelled SIMULATED lane-local content bench: that can complete the independent asset task, but not the final in-kingdom integration task. Record the precise missing mount as `needs:`. Do not wait to author independent content, and do not claim that a bench proves integration. Do not run a screenshot matrix. SwiftShader is not performance proof.

## References
`packages/content/README.md` for blueprint lattice, materials, validation and render; `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/World-Tree.md`, and `chatdom/Moments.md` for the visual and social bar. `work/specs/39-channel-genesis.md` is authoritative for the API and real-target provenance.

## Decisions
2026-10-31: Local adapter consumes the recipe and selected landscape, without changing frozen contracts. Root integrates and validates external assets. Show simulated inputs honestly; absent approved channel material stays absent. Review the first three compositions before expanding breadth.

## Scope
Write only `packages/content/src/genesis-landmarks/**` and this lane’s PRD/progress. All other paths are read-only. Lane-local tests, fixtures and credits belong inside that scope. Existing assets, engines, shaders, shared contracts, package manifests and consumers are main-owned.

## Not now
No terrain, adoption, provider approvals, Atlas integration, package export changes, live channel claims, or additional landscape breadth.
