# Spec 43: Keepers of places · status: frozen 2026-10-31

Vision: `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/World-Tree.md`, `chatdom/Moments.md`.

## What and why
A few place-bound keepers make a quiet kingdom welcoming without impersonating its people. Two keepers are selected by the recipe; their roles and authored names are fantasy, not invented community history.

## Rules
1. Read `soul.keepers` role, name, placeId and selected landscape; preserve the provided attachment and `carriesPresenceLight: false`. No citizen, Twitch identity, avatar count, presence light or fabricated audience. Keepers retreat as real people fill their places; expose the condition to main without inventing a presence contract.
2. Adapt existing avatar rig, wardrobe, cape, material and animation facilities for distinct innkeeper, lamplighter and ferryman variants. A prop lamp is not a presence light. Include grounded routines and tool/door interaction affordances, bounded to their places, and brief authored greetings containing no unsupported channel facts.
3. Provide local deterministic appearance/routine proposals and tests for role and place preservation, absence of presence/count semantics, and retreat intent. Actual navigation, speech delivery and interaction runtime remain main-owned; never fake them in a shot.

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
Write only `packages/content/src/genesis-keepers/**` and this lane’s PRD/progress. All other paths are read-only. Lane-local tests, fixtures and credits belong inside that scope. Existing assets, engines, shaders, shared contracts, package manifests and consumers are main-owned.

## Not now
No terrain, adoption, provider approvals, Atlas integration, package export changes, live channel claims, or additional landscape breadth.
