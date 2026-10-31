# Spec 41: Crests and banners · status: frozen 2026-10-31

Vision: `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/World-Tree.md`, `chatdom/Moments.md`.

## What and why
Make kingdom heraldry readable at stream distance and intimate on approach: a coherent crest, cloth cut and carved standard with distinct crafted shapes. Colours sourced from the recipe are targets, not approved palette materials; missing profile colours give an explicitly neutral proposal, never claimed channel branding.

## Rules
1. Consume recipe `identity.crest`, `identity.banner`, `identity.profileColourTargets`, `identity.styleFamily` and selected landscape. Snap targets deterministically to registered kit materials, preserving contrast and never mutating the palette; use an honest neutral treatment when empty.
2. Reuse `packages/content/src/civic/heraldry.ts`, civic kit, and avatar cape facilities where appropriate; expose adapter outputs for crest/banner and cape-compatible visual treatment without modifying those files. Cover all existing shape, charge and cut variants; do not add recipe values.
3. No emote charge or channel colour claim without a separately approved derivative; no source receipts in public scene output. Verify determinism, bounded palette and legibility of the three neutral showcase proposals.

## Current state and contracts
`work/specs/39-channel-genesis.md` and `packages/world/src/genesis/contracts.ts` freeze the local `@chatdom/world/genesis` recipe. Consume a `DeepReadonly<ChannelKingdomRecipe>` and the explicitly selected member of `recipe.landscapes`; the recommendation is not the selection. Adapt existing content, materials and rendering/audio facilities. This lane creates a local adapter and its own fixtures; main owns package exports, dependency wiring, composition, terrain, publication, provider approval, adoption and Atlas. Do not change `packages/shared` or pretend an anchor proves ground or access. If an actual integration port is missing, record `needs:` in progress with its precise shape; continue independent asset work.

The three composition targets are The_AGGman (63920635, coastal hamlet), PinkKittyRose (4363967, river town), MashaD4 (154972160, mountain city), using spec 39's 30 October observed snapshot. Categories are artistic inputs, not community claims. No profile colours, emote approvals or lore were captured. Never invent them. Testbench inputs and any simulated derivative are visibly labelled SIMULATED, including screenshots. Do not present a mock as approved channel art. Internal source references are not public scene data.

## Acceptance and quality
Use the existing palette and style kits; crafted, warm toy-diorama detail, clear silhouette, believable scale and grounded contact. Assets must be deterministic and fit existing schema/material/budget constraints. Run focused tests for the lane, `pnpm typecheck`, and relevant validator where applicable; document exact executed commands and results in progress. For each visual change, capture and inspect one 1920×1080 stream-first shot of the most representative affected composition; record its path and finding. Until main supplies the composition mount, use a labelled SIMULATED lane-local content bench: that can complete the independent asset task, but not the final in-kingdom integration task. Record the precise missing mount as `needs:`. Do not wait to author independent content, and do not claim that a bench proves integration. Do not run a screenshot matrix. SwiftShader is not performance proof.

## References
`packages/content/README.md` for blueprint lattice, materials, validation and render; `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/World-Tree.md`, and `chatdom/Moments.md` for the visual and social bar. `work/specs/39-channel-genesis.md` is authoritative for the API and real-target provenance.

## Decisions
2026-10-31: Local adapter consumes the recipe and selected landscape, without changing frozen contracts. Root integrates and validates external assets. Show simulated inputs honestly; absent approved channel material stays absent. Review the first three compositions before expanding breadth.

## Scope
Write only `packages/content/src/genesis-heraldry/**` and this lane’s PRD/progress. All other paths are read-only. Lane-local tests, fixtures and credits belong inside that scope. Existing assets, engines, shaders, shared contracts, package manifests and consumers are main-owned.

## Not now
No terrain, adoption, provider approvals, Atlas integration, package export changes, live channel claims, or additional landscape breadth.
