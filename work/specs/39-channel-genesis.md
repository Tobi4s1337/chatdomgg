# 39 — A kingdom from every channel

Owner: chatdom-main. Architecture/core pass: Genesis architect, 2026-10-31. Local composition contract frozen after main review, 2026-10-31, at `@chatdom/world/genesis`.
Shared promotion, scene composition and adoption remain main's work.
This spec has no active lane. The one architecture pass is complete; main carries integration on Sol.

Every Atlas channel has stable, distinctive land waiting behind its mark. Clicking an unfounded channel may reveal
its **potential kingdom**, honestly labelled **Unfounded land**. A real founded kingdom always opens its exact
adopted plan and approved scene. Willowmere and every other existing kingdom keep their land, homes and history.

## Authority and vision

Read against `ChatDom.md` principles 1, 3, 5, 9, 10, 16–18; `World-Tree.md` §§3, 5, 9, 14; `Quality.md` rules 1,
5–6, 8–11, 15–17; `Monarch.md` §5.2; `Tech.md` §§9.3, 11.1–11.2; `Atlas.md` §4.2; and `PLAN.md`'s Genesis contract.

The new explicit instruction to show deterministic land for every Atlas channel changes the older prohibition on
any view before founding **only for a public procedural potential**. It does not authorize a private Codex founding,
invented history, citizenship, saved deeds, monarch powers or an implicit adoption during entry. Existing waiting-land
settlers/tents remain a separate real record; `canSettle: false` below means this compiler cannot allocate them.

Durable Genesis remains a monarch-pressed live ceremony: checked names first, a ranked Charter, chat's vote,
checked map, at most two redraws, 15-second rise, one atomic adoption. At four minutes a checked deterministic
recipe replaces a failed/slow model Charter. An interrupted ceremony saves no half-founded kingdom. The model
selects and decorates permitted shapes; it cannot change the identity seed, truth, safety gates or budgets.

## Data model and implemented API

All new types are local. `packages/shared` is unchanged. The first consumer is the three-kingdom composition
work; main has exposed `@chatdom/world/genesis`. Shared realm/adoption contracts freeze with their consumers.

| API | Contract |
|---|---|
| `ChannelGenesisFactsSchema` | Strict bounded input: full decimal broadcaster ID; observed or visibly SIMULATED provenance; average viewers and optional followers; exact observation-window hours; up to 16 observed categories and minutes; up to 4 profile colour targets; up to 12 approved emote asset references scoped to permitted uses; approved description derivatives; optional evidenced oldest follow year |
| `compileChannelGenesis(input: unknown)` | Returns a deeply frozen `ChannelKingdomRecipe`. No I/O, current clock, global RNG, model invocation, adoption, people or allocation. Identical facts, including provenance, yield identical bytes; source category/emote order does not matter |
| `sampleGenesisSurface(landscape, x, z)` | Executable natural surface in world metres: existing v2 hills/river/lake plus ocean coast and dry offshore islands. Returns ground height, optional water level and ocean/inland classification. Not a settled/graded scene or an assertion that chunks are loaded |
| `resolveGenesisEntry(input, adoptedManifest)` | Trusted read-only routing seam. A valid adopted manifest wins using only broadcaster identity; profile-service outages do not trigger regeneration. Corrupt/mismatched adopted records fail. Explicit null means no adopted record and returns potential recipe, label and `canSettle: false` |
| `OBSERVED_GENESIS_FIXTURES` | Three observed, sourced inputs in `observed-fixtures.ts`. Not automatically published or imported into the runtime barrel |
| `OBSERVED_GENESIS_SHOWCASE_CHOICES` | Explicit coast/river/mountain choices for the requested three targets. These are art direction, not Twitch facts or a durable Charter |

`seedKey = channel-genesis-1/broadcaster/<decimal-id>`. Do not convert IDs to numbers, seed from login, or use a
32-bit hash as identity. Each draw hashes its semantic slot before the complete seed key, so adding a feature does
not consume another feature's random stream. Physical landscape candidates depend only on version, broadcaster
identity and candidate rank. Categories, profile refreshes and follower changes cannot alter these candidates.

Recipe control data contains:

- Five sizes, reserved home capacity, ward intent, city/capital cathedral site, append-only growth and optional
  follower planning evidence. Capacity creates no person, plot assignment or lit window.
- A curated category interpretation: biome, authored landmark family, Hearth/Tide/Grove style-family choice,
  colour targets, crest and banner grammars. Recognized category weight is observed minutes; ties use category ID.
  Unknown categories get the neutral meadow/bell-garden treatment. The dictionary is an artistic interpretation,
  never a claim that a community did something. Raw category names do not leave the compiler.
- Three seeded candidate compositions: coastal harbour, river valley and mountain pass, each rotated and shaped by
  identity. Candidate order/default recommendation is seeded, independent of size. All sizes can have every landscape.
  Redraw selects another already prepared candidate rather than shifting random calls or running another model.
- Existing `KingdomLandform` v2 hill/stream/water primitives, an explicit shoreline and island union, forest/campfire
  clearing, mountain saddle and semantic civic-place anchors. Old Row is nearest the castle. The reserve is the
  initial civic neighbourhood, not a claim that 1,536 buildings fit inside it.
- Two handmade keeper roles with authored names and place attachment, no presence light and no population count;
  real-event-only history; weather seed; realm-time clock policy; biome soundscape. Keepers retreat as people fill
  their places. This module chooses their identity, not animations, pathfinding or spoken lines.

No raw description, model prompt, display name, image bytes or external image URL is accepted. Description supplies
only source hash and current approved motto/lore derivatives. A cosmetic name is authored fantasy; it does not
assert a past event. Old Row may reserve a place before follower history is known, but never invents a follow year.
Its eventual allocation uses actual follow-year quarters and sub-month street choice once. History starts with
actual founding and witnessed community facts, not invented raids or ancestors.

Approval IDs are references, not authority. The server facts adapter must validate current channel-bound receipts;
the publishing/stream gate validates them again against the composed derivative. Glass approval does not grant
permission for a three-metre statue. Missing emotes or description derivatives remain absent; no generic statue
is presented as a channel emote. Raw profile colours are scalar targets, not palette-approved material values:
the style-kit compiler snaps them to the shared palette and validates the final crest/banner composition.

The complete recipe is an internal compiler input, not an HTTP response schema. Public geometry uses the existing
approved scene allowlist and strips approval receipts and private source lineage. No caller may serialize the
whole recipe into a public scene to avoid implementing that projection.

## Size, streets and whole-world growth

Existing Atlas average-viewer thresholds are authoritative; this work does not silently redefine them.

| Average viewers in documented observation | Tier | Reserved starter capacity | Ward intent | Civic scale |
|---|---|---:|---:|---|
| Under 25 | Hamlet | 16 | 1 | A small lovely square, intimate castle and full set of places |
| 25–49.999… | Village | 48 | 1 | More garden streets around the same intimate centre |
| 50–499.999… | Town | 160 | 3 | Distinct neighbourhoods and a developed river/road junction |
| 500–4,999.999… | City | 512 | 8 | Wards and a reserved communal cathedral site |
| 5,000 and over | Capital | 1,536 | 24 | Connected ward centres and a capital silhouette |

Unknown averages are explicitly unknown hamlet potential, not measured zero. Followers are optional
`followerGrowthHint`: they inform how much outward settlement space to examine and when to request more history,
but never equal residents or change Atlas tier. Current source has no follower counts. A combined follower/average
tier formula needs main's frozen decision; none is invented here. The founding allocator plans actual lots from
real tenure evidence, uses full 8×16 m reserved footprints and keeps all existing IDs/slots/positions stable.

For a capital, many wards are represented at a distance and loaded locally. People are represented by their real
homes/windows, named up close, with distant aggregate presence tied to real counts. A follower total, capacity or
category average is never a count of avatars. No crowd of fake walkers and no empty shells to pretend occupancy.
Small kingdoms keep equal material, lighting, interaction, animation, sound and compositional quality; their places
are closer and their framing more intimate. An inactive large kingdom rests rather than manufacturing a crowd.

The growth compiler extends an adopted street graph from its reserved exits. It never reruns this recipe to move
Old Row, reshape an occupied coast, demote a ward when metrics drop or replace a home with another tier. The exact
selected recipe/version and resultant `SettlementPlan` become immutable adopted inputs. Later category/colour/
emote changes are checked cultural changes and small ceremonies; land remains where it was.

## Terrain, layout and adoption seams

Current `KingdomConfig`/`generateSettlementPlan` only understand `hamlet | town`, and activate 12 or 48 homes per
quarter. Mapping five tiers into those two values would fake the new contract. The new size capacities are explicit
proposal data; the root builder must extend a recipe-driven allocator or create its versioned consumer while
preserving existing plans. Do not call the current generator and label its result a 16-home hamlet or capital.

Similarly, v2 `LandformPlan` knows lakes and streams, not an ocean minus islands. The core's `genesis-coast-1`
sampler composes the existing hill/water core with a shore profile and elliptical island land masks. Ground is dry
at island centres, below sea level around them, and the main river descends to the coast. The sampler is working
code, but it is **not registered** in `LandformPlan`, founded collision or browser terrain dispatch. Main must
promote a new persisted surface shape and wire the exact same sampler to both sides before walking it.

The resulting pipeline is facts snapshot → recipe → selected landscape → roads/grade/lot proposals → approved
content placement → beauty/collision/egress checks → immutable scene bytes → adoption. Water constraints precede
streets. The current pure anchors and saddle heights are planning suggestions, not proved navigable placements.
The real layout compiler grounds every entrance, proves step/slope/bridge access, reserves full lot depth and rejects
an invalid candidate before it can appear as an explorable town. No roads across invisible dry water floors.

Adoption consumes the existing single-writer service, exact `SettlementPlan`, public-checkpoint agreement,
`RealmFoundedScene` allowlist, immutable SHA-256 scene bytes and coherent `adoptWorld` operation from spec 38.
`resolveGenesisEntry` is intentionally only a guard; it grants no authentication, signature, live authorization,
deed or publication authority. A manifest-store failure is not a null record. Existing adopted content wins even
if all current external channel facts are unavailable.

## Hot paths and budgets

These are implementation constraints and measurement targets, not measured GPU claims.

| Path | Budget and behavior |
|---|---|
| Atlas overview | Existing compact Atlas data only. No recipe per map mark; no eager generation for 260,000 channels |
| Selected channel | Read adopted receipt first; if absent compile/cache one bounded recipe from a pinned facts snapshot. Target warm compilation p95 ≤5 ms server/worker; no per-frame compilation |
| Recipe control payload | Hard maximum 64 KiB UTF-8 including all three candidates; no assets or per-follower arrays. Input capped at 16 categories, 12 emotes and 4 colours |
| Cache memory | Target ≤256 KiB heap per compiled recipe; bound LRU to 128 entries / 32 MiB and release weak terrain preparations with it. Measure heap before raising either cap |
| Terrain build | Worker only, fixed-size tiles, abort stale camera/recipe jobs. Target ≤8 ms per worker slice; never block a frame with full-landscape sampling/meshing |
| Render integration | Recipe CPU work is zero during normal frames. Incremental installation target ≤2 ms/laptop frame, ≤1 ms/phone frame; device targets remain 60/30 fps and OBS 60 fps at 1080p |
| Initial entry | Visible response with sound ≤100 ms, designed loading ≤1 s, explorable scene target ≤5 s on laptop/normal connection. Stream selected terrain/assets, not all 24 capital wards |
| Network | Recipe ≤64 KiB; shared approved assets content-addressed and cached; no polling full recipe for presence/weather. Target initial compressed scene/asset working set ≤2 MiB before progressive detail; measure against real assets |

Canonical geometry coordinates are snapped to half metres at generation; finer authored assets keep their own
0.125 m lattice. Display LOD does not alter surface identity. The coast sampler currently uses the existing v2
water-preparation cache and bounded feature counts. Root should benchmark chunks on actual consumer paths before
promising those slice/entry targets. SwiftShader screenshots establish appearance, not GPU performance.

## Three real compositions and provenance

The latest brief requests exactly three finished compositions before breadth. These are the selected real inputs,
not invented communities. Their profile metadata remains incomplete.

| Channel / broadcaster ID | Captured average | Dominant captured category | Explicit showcase choice |
|---|---:|---|---|
| The_AGGman / 63920635 | 16 | Counter-Strike, ID 32399, 230.9946 minutes | Coastal hamlet |
| PinkKittyRose / 4363967 | 139.98 | Retro, ID 27284, 324.4682 minutes | River town |
| MashaD4 / 154972160 | 852.12 | Chess, ID 743, 87.1052 minutes | Mountain city |

Source: `shots/atlas-data/revisions/obs-20261030T163224Z-8fff6dfa7def/`:
`import.json`, exact rows in `channels.ndjson`, and category names joined from `games.ndjson`. Manifest content hash
`8fff6dfa7def68539d72272e8996846998dcdcc6df8b36c4e4b42be7971f8b03`; channel-file SHA-256
`220586df13ee669498fe2fdbc58be4700cc7cd840137534d3b61023767319691`; game-file SHA-256
`68a0462dc79091e29417ace89120ec2e1d0b07dacdf674dc7a04eb627cff0397`.

The snapshot covers 2026-10-29 15:44:59.490Z through 2026-10-30 16:32:24.392Z: 24.79 hours, 497 sweeps, no gaps.
These averages are over observed live minutes, not a claimed 30-day average. The_AGGman was below the snapshot's
kingdom-candidate threshold; its last stream category was Hell is Us (119464928), observed for 201.2566 minutes,
not its dominant category. The fixture retains both categories. No current live-state claim is made.

Followers, profile colours, descriptions, approved emotes and follower tenure are absent from this capture. Fixtures
retain null/empty values. Each finished composition must gather and check those real inputs before claiming its
own emote statue, crest colours or channel-derived lore. Unchecked source availability is not approval. The source
also has unknown content classification; existing access/publication policy still applies.

## Decisions and why

1. Public deterministic potential and durable live founding are distinct states. This implements every-channel
   Atlas entry while keeping the community's live naming/rise and existing ownership real.
2. Full broadcaster identity and labelled feature seeds make coastline independent of login, content order,
   unrelated features and mutable size. Recipe and asset versions are frozen with adoption; a generator update
   never retroactively changes land.
3. Keep five size intents explicit and preserve Atlas thresholds. A 16-home hamlet is not the existing 12-home
   generator with a different label. Followers are growth evidence, never synthetic population.
4. Seed the default landscape independently of size. The three requested compositions are explicit art-directed
   selections from the same grammar; other hamlets may be mountainous and capitals coastal.
5. Reuse v2 primitives, add a named coast surface seam, and do not cast it into an already adopted landform.
   This proves islands without destabilizing Willowmere or quietly changing collision interpretation.
6. Approved derivative references carry culture. Profile text has no path into code, prompts or visible words
   through this compiler; no model invents facts. The actual binding gates remain external.
7. Keepers, time, weather, named places and biome sound are part of the recipe. They give quiet places character
   without fake citizens. History remains witnessed and long-time viewers remain near the castle.

## Builder and artisan handoffs after main review

Main owns recipe promotion, five-size settlement consumer, terrain dispatch, live ceremony/adoption orchestration,
source adapter and the Atlas route. Complete the three chosen compositions and look at them before fan-out.
Do not start these outlines as lanes without main's review and rewritten PRDs.

- **Landmarks:** one content builder owns authored landmark families, real footprints/doors/interactions and a
  grounded recipe placement consumer. Demonstrate harbour watchtower, Retro river landmark and chess-themed
  mountain civic landmark without copying third-party game assets; city includes its cathedral site.
- **Crests and banners:** one artisan owns palette-snapped channel colour treatments, readable heraldic shapes,
  cloth silhouettes and reviewed contact sheets for these three. Missing source colours must remain an honest
  neutral proposal, never invented channel branding.
- **Emote statues, vanes and glass:** one artisan owns approved asset derivatives for the three real channels,
  usage-specific approval lineage, silhouettes/contact sheets and material/scale budgets. Integrate actual approved
  emotes; omission is honest while blocked, but does not satisfy the finished three-composition bar.
- **Keepers:** one character artisan owns two place-bound keepers with grounded routines, tool/door interactions,
  authored personality variants and short fact-bound speech. No lights, counts or Twitch chat identity.
- **Biome sound:** one audio artisan owns coastal wind/water, river/meadow and mountain beds, weather/time layers,
  place sounds and non-repeating variation, with permissive sources credited. Check the stream mix beside a game.

## Evidence and doubts

Implemented: pure schema/compiler, seeded terrain candidates, actual coast/island surface sampler, adopted-world
routing guard, sourced three-channel fixtures, four focused tests. The tests cover deterministic bytes/order,
full-string IDs, unchanged terrain under mutable channel facts, all Atlas band boundaries, 16-home hamlet capacity,
downhill rivers, dry islands/wet surrounding sea, existing v2 sampler compatibility, approved-use separation,
raw-text rejection and adopted-record precedence/failure.

Verified: focused Vitest 4/4; scoped ESLint; repository TypeScript check. No git commands, shared edits, adoption,
runtime integration, lane launches or screenshots. No rendering changed. The three actual kingdoms are not yet
shown or proved beautiful: terrain/settlement consumer, source approvals and content composition are the concrete
remaining work. Natural anchors/saddles are not a navigability proof; real-device timing, composed coastal seams,
city ward streaming and the initial byte/heap targets remain unmeasured. Those limitations must stay visible in
main's handoff rather than being mistaken for a completed Atlas feature.

## References

- [Channel Genesis study](../references/channel-genesis.md): landmark-before-road ordering, independent seed
  domains, water as a real land constraint; source-only, independently implemented.
- [Organic towns](../references/organic-towns.md): persistent connected streets and local outward growth.
- [Spec 38: founded kingdom](38-founded-kingdom.md): exact adopted plans, approved public scenes, collision and
  immutable scene receipts. Entry never implicitly founds.
