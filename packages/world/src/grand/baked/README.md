# Installed grand land artifacts

This is the shared preparation and baked format for the existing pinned installed land compiler. It preserves
the installed settlement's translation, floor, paving, water and region mesher. It does not install a new client
loader or change a founded recipe. The parent realm owns durable storage and receipt publication.

## Entries and identity

- Offline only: `prepare.ts`, `mesher.ts`, `metadata.ts`. `prepareInstalledLand(plan, recipe)` runs the existing
  generator, reservation-based seat and exact floor verification. `createInstalledRegionMesher(prepared).mesh(key)`
  meshes one region synchronously. Use Vite's module transform/bundle because the installed kits use `import.meta.glob`.
- Browser safe: `codec.ts`, `surface.ts`, `types.ts`. Their runtime graph contains no generator, kits or tree builder.
  Never add a barrel that re-exports offline modules from the reader entry.
- `identityForBakedLand(plan, recipe)` records full kingdom identity, canonical recipe SHA-256, canonical source
  plan SHA-256 and its revision. Only those hashes/revision enter metadata; the plan and citizen state do not.
- `createBakedMetadata(prepared, identity, surfaceRef, regionRefs)` explicitly projects public fields, canonicalizes,
  validates and recursively freezes metadata. It rejects extra fields. No generator timing or preparation diagnostic
  enters any artifact hash. The caller must obtain the identity from the exact inputs it prepared.
- Metadata hashes bind the source plan, recipe and compiler versions. Publication additionally binds the metadata
  hash to the validated founded scene receipt, layout/collision revisions and kingdom. Growth may publish a new
  artifact with a new source plan while retaining the original recipe hash. A newer compiler never silently mutates
  existing content-addressed artifacts. Artifact availability alone grants no physical support or authority.

## Portable format version 1

All binary integers are explicitly little endian; host typed-array endianness is never assumed. Decoders accept
unaligned byte views, enforce allocation limits first and return owned typed arrays. Blob hashes cover raw canonical
bytes. Compression belongs to the store: normalized gzip (mtime 0, OS 255), with separate gzip hash and byte count.
Clients must verify compressed length/hash, bounded decompression, raw length/hash and metadata descriptor/header
agreement before installation. Compression is not a substitute for validating the decoded payload.

The region header is 64 bytes:

| Byte | Value |
|---:|---|
| 0 | `GDR1`, four ASCII bytes |
| 4, 6 | uint16 version 1, header length 64 |
| 8, 10 | uint16 region x, region z |
| 12 | uint8 level 0..3; bytes 13..15 are zero |
| 16, 20 | uint32 minimum/maximum Y, in this level's voxels, chunk-aligned |
| 24, 28 | uint32 quad count, quad payload bytes |
| 32..59 | Seven uint32 cumulative offsets **in quads**, faces +X,-X,+Y,-Y,+Z,-Z |
| 60 | Four zero reserved bytes |
| 64 onward | Existing eight-byte packed quads, two uint32 words per quad |

Quad packing is unchanged from `packages/voxel/src/grand/quad-mesher.ts`. Validation checks face grouping, monotonic
offsets, dimensions/spans, reserved bits, material zero, regional chunk slots, Y bounds and exact payload lengths.
The source mesher applies the installed-floor correction including the halo, hides sea fill, keeps vertical flowing
water faces, and removes horizontal water faces owned by the native water renderer. Physical intersections have
exactly L0; every other region has all four levels. Metadata orders regions z-major/x-minor and levels ascending.
Region bounds are conservative native metre bounds over all mesh chunk bounds, including skirts/structures. At a
coarse level they may exceed the nominal world height by the final chunk's padding.

The surface header is 32 bytes: `GDS1`; uint16 version/header length at 4/6; uint32 size, height, sea level and column
count at 8/12/16/20; bytes 24..31 zero. Payload is a full uint16 ground raster followed by a uint16 water raster,
x fastest. Values remain in half-metre land units. Water zero is dry. `bakedVisualHeight` translates native queries;
`bakedNativeWater` reproduces the existing native float ground/water inputs, including dry NaN water levels.

Metadata is strict canonical UTF-8 JSON: format/compiler identity, kingdom/recipe/plan identity, dimensions, seat,
native total and physical bounds, palette, surface descriptor and complete per-region descriptors. Hashes are
lowercase SHA-256. Unknown keys, noncanonical JSON, duplicate/missing regions, unsupported levels, changed compiler
strings and bounds inconsistent with descriptors fail closed. Decoding freezes every metadata object and array.

## Budgets and hot paths

Limits: metadata 256 KiB raw; one mesh 8 MiB quad payload plus 64-byte header; source side at most 4096 and height
at most 512. The height limit follows the packed chunk-slot Y nibble. Exceeding a bound is an explicit format/compiler
decision, never truncation. Region encode/decode is linear in quads; surface encode/decode is linear in columns;
metadata validation is linear in the manifest. Codecs have no per-frame work and land has no per-frame network traffic.

A 2560-square surface is 25 MiB raw plus its header. The native water adapter adds 50 MiB of float rasters. It must be
installed once and released with its water owner; it is not a per-frame operation. These numbers expose an outstanding
phone/working-set problem. A tiled water/raster owner or lazy sampling is needed before claiming the spec's phone
budget or the first-street cold-load budget. Gzip transport does not reduce resident decoded bytes.

One mesher owns its scratch volume, voxel context/tree cache and buckets. Bake one kingdom at nice 19, with at most
two workers, and write each completed blob immediately rather than retaining all mesh results. The first offline
runner may use one thread. Browser region installs still need the existing per-frame install cap and bounded request
queue when the loader is wired. This extraction neither improves nor proves renderer frame time.

## Prior art and decisions

The prior [streaming study](../../../../../work/references/grand-world-streaming.md) and
[AO/halo study](../../../../../work/references/voxel-meshing-light.md) remain the architecture references. Re-read the
MIT `binary-greedy-meshing` checkout's `src/mesher.h:46–73` (padded neighbours and face counts), and the MIT WebGPU
voxel engine's `src/world/mesh-format.ts:4–10,65–71` and `chunk-manager.ts:56–74,387–395` (packed faces, explicit
capacity, stale-result rejection). A read-only research scout reviewed the codec hazards. No upstream code is copied.

Take compact quads, independent capacity limits, explicit offset units and immutable result identity. Keep Chatdom's
AO/material merge semantics, 32-cube chunks, half-metre physical floor, WebGL2 renderer and native water owner.
The browser never needs source trees/cover/structures to read a baked artifact. Full source data belongs only to the
offline compiler, not a browser cache. An authoritative physical-page handshake remains separate from visual LOD.

## Evidence and handoff

Focused tests cover explicit endian bytes, detached/unaligned decode, malformed lengths/flags/spans/offsets, full
surface preservation, native water semantics, immutable canonical metadata, complete physical/far LOD coverage and
installed paving/water behavior. `legacy-mesher.test-helper.ts` retains the original hosted worker algorithm as the
byte-parity oracle for the extracted mesher. The existing hosted prepare tests continue to cover exact floor and halo.

The realm builder owns persisted recipes, normalized compression, content-addressed writes, validated receipt binding,
same-bytes-across-process checks and actual bake CPU/memory/size evidence. Client builders can then add bounded
nearest-region loading, current receipt validation, blob verification and designed progress from real work. Artisans
own the map-to-street loading sequence on those real events. Keep the existing renderer until complete artifacts exist.

Doubts: real-world largest region sizes, actual gzip ratios, full-bake memory, cold/warm network times and the native
water adapter's resident memory require measurements. No physical GPU or visual claim is made by these CPU tests.
