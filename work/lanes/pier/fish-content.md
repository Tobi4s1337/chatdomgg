# Fish content

## Decisions

- Fish use the existing creature lattice (0.0625 m), the registered clay palette and fresh CPU-owned voxel buffers. They are creatures, not build blueprints. No shared blueprint widening or new materials.
- Each model has a nose (+Z), a mouth and a tail wrist in its own cell coordinates. The same factory supplies the water, catch reveal and item portrait; caught length scales the model uniformly. Authored bounds stay stable.
- Twelve species form this PI10 set, across three rarities. Lantern Eel requires night; Mistfin Trout requires dawn mist. Generalist common fish provide an eligible catch at every hour and mood without inventing a biome for an old founded plan.
- Mossback Carp belongs to meadow and woodland lakes; Redfin Char belongs to highland water. These use actual Genesis recipe ids. A plan with no adopted biome cannot roll them, while the wildcard species remain available.
- Roll weight is a server selection weight, never the fish's mass. Sizes, conditions and fight profiles are authored once beside the model catalogue. No item or species registration until the rendered models have been reviewed.
- All fish are non-emissive. The Lantern Eel has warm gold markings; people's lights remain the source of light.

## Authoring contract

`packages/content/src/fish/model.ts`: `FishModel { asset: VoxelAsset, mouth: Vec3, tail: Vec3 }`; factory `fishModel(id, sculpt, mouth, tail)`. `Sculpt` and `loft` reuse the water critters' authoring primitives. Maximum 32 cells per axis, at most 4096 occupied cells per fish, palette ids from `MAT`. All cells face-connected. Factories take no random input and return independent buffers. Distinct silhouettes before colour: fork tails, dorsal fins, mouth, paired dark eyes. No tiny decorative noise.

File ownership:

- `shoal.ts`: `createCopperPerch`, `createBellMinnow`, `createReedRoach`, `createSilverDace`.
- `deep.ts`: `createLanternEel`, `createMoonlitPike`, `createMossbackCarp`, `createWhiskerCatfish`.
- `shore.ts`: `createMistfinTrout`, `createSunBream`, `createPebbleFlounder`, `createRedfinChar`.

Factories return `FishModel` with asset id `fish:<kebab-name>`. No catalogue edits from sculptors.

## Review

Three views per fish at dusk, grouped on readable contact sheets. Production voxel meshing and materials. Validate bounds, anchors, palette, face connectivity, owned buffers and meshed budgets. Review every sheet and replace weak silhouettes before registration.

## Reviewed checkpoint — 2 November 2026

All twelve fish and the willow rod passed the three-view dusk review. The shoal group had one improvement round:
solid paddle tails became notched forks with narrow wrists, and the perch, minnow and roach gained longer tapered
heads. No species was cut. The eel is a low winding ribbon, the pike has a projecting jaw and rear fins, the carp
is broad and arched, and the catfish has connected pale whiskers. The flounder's upper eyes and diamond body read
from above; the bream is round and the trout and char keep separate back, fin and cheek markings.

The rod uses the hand/creature lattice for its held asset, with explicit grip and line-tip anchors. Its rest wand is
rigid; runtime bend, line and fishing motion are still part of the presentation checkpoint. It has no luck or paid
upgrade metadata. There is no startup grant.

Production registration now resolves all thirteen definitions to their actual fresh voxel factories. Realm species
are validated once; common and uncommon fish stack to 99, personal firsts are protected by the catch writer, and
rare fish and rods never stack. The browser's model registry is lazy and registration is atomic. The review bench
uses that same registry, rather than a separate portrait fixture.

Nine focused tests pass. Fish mesh to 328–1,164 triangles each, the rod to 262. Each view measures one colour draw;
the dusk sheet also measures one shadow draw per model. These are content costs, not the complete fishing layer
or frame timings. All stills are software-rendered: the real-GPU tunnel returned exit 3. The evidence README lists
the files and remaining demonstration. No database, shared contract or external hook changed in this checkpoint.

## PI11: twenty-eight fish, four legends and the mounts — 2 November 2026

Sixteen fish join the twelve: still water (`still.ts`: Glimmer Rudd, Thimble Gudgeon, Willow Tench, Starlit Bleak),
sunlit and cold water (`sunlit.ts`: Ember Sunfish, Pearl Grayling, Hollow Burbot, Saltmarsh Mullet), the sea
(`sea.ts`: Harbour Mackerel, Driftglass Herring, Inkfin Wrasse, Tidepool Sculpin) and the four legends
(`legends.ts`). Each was reviewed on its four-view CPU sheet (`preview.test.ts`, run with `PIER_PREVIEW=<ids>`); the
content test checks that every shape is distinct, connected, meshes and stays inside the avatar lattice.

Decisions:

1. **Legends are rare, weight 1, and never come off a chat line.** Each needs a narrow window: the sturgeon at night
   in rain on a lake, the emperor at dusk in clear weather, the ray at night at sea, the char at dawn in mist in the
   highlands. The Almanac shows them in their own chapter.
2. **Every kingdom's lake has at least fourteen fish; the rest is that kingdom's own.** Fish with a `share` live in
   that share of kingdoms, fixed per kingdom (`kingdomHoldsFish`), so two kingdoms' Almanacs differ in what is
   "waiting" and what is "elsewhere". Sea fish and biome fish are caught only where those waters are.
3. **Riddles, not blanks.** Every species has a riddle distinct from its lore; an unknown page shows the silhouette
   and the riddle.
4. **Mounts are the real model on a carved plaque** (`packages/content/src/keepsakes/`), cropped and turned in exact
   quarter turns so every voxel of the fish is the one you caught. A fish twice as wide as it is tall (the ray, the
   flounder) shows its back. The sheet is `shots/pier/mounts.png`.
