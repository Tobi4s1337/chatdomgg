# Reference: MagicaVoxel's byte format and three.js VOXLoader

For: `work/specs/15-vox-import.md` · studied 2026-10-30.

Primary format repository: [ephtracy/voxel-model](https://github.com/ephtracy/voxel-model), MIT,
studied at `3bff8feaa7d94a6237f2c07dc4ca3c3d268ef06c` in
`/tmp/chatdom-refs/ephtracy-voxel-model`. Three.js loader is a secondary implementation reference from its
[official source](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/VOXLoader.js), MIT; read via
the official raw source, without adapting its code or treating its moving `dev` branch as a pinned dependency.

## What it is

The format's author publishes the compact object container and its scene extensions. That distinction matters:
voxel objects and scene instances are different representations. Three.js demonstrates the axis conversion
and confirms support for file versions 150 and 200. Its renderer is not the import boundary Chatdom needs.

## What we take

- Local `MagicaVoxel-file-format-vox.txt:33` describes separate content and child byte lengths. Validate both
  before advancing; a browser buffer is not permission to read past an enclosing chunk.
- `:58` and `:68` define dimensions and four-byte voxel records. `:77` supplies the important palette offset:
  the first RGBA entry serves colour index 1. `:91` gives the fallback palette. Black is an occupied colour.
- Local `MagicaVoxel-file-format-vox-extension.txt:1` establishes stored model order. `:63`, `:83` and `:95`
  separately describe scene transforms, groups and shapes. Object selection must state when scene assembly
  is outside the imported representation. `:109` separates material properties; `:159` adds palette remapping.
- Official [VOXLoader](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/VOXLoader.js)
  `decodeRotation`/`toThree` converts Z-up to Y-up with an axis sign change. For normalized cell indices our
  equivalent is `(x,z,sizeY-1-y)`, followed by occupied-bound normalization. The minus-one belongs to cell
  indices; vertex transforms use box boundaries instead. Applying only a Y/Z swap would mirror the object.

## What we do differently

These are Chatdom decisions, not claims of the format specification:

- The pure parser produces bounded data, with no three.js resources, URL fetches or scene material creation.
  A real object becomes a `VoxelBlueprint` and enters the same private draft as a hand-built wall.
- Every read, count, chunk and allocation has an executable limit. A bounded structured error is useful to the
  builder; an exception from `DataView` is not the intended interaction. Main's policy remains authoritative.
- The importer chooses an explicit object. It never labels a first model as an assembled scene. Unsupported
  palette remapping fails rather than silently painting the wrong colours; scene/material differences are
  visible before insertion. No source emissions or render properties bypass the kingdom style.
- Colour maps only onto the draft's allowed style materials. Preview and edit use the same snapped geometry,
  transform and replacement bounds. A box with air inside also replaces old blocks there, so that whole box
  is visible before the builder confirms.
- A small original asymmetric fixture supplies the demonstration and one useful malformed-input test.
  Reference repository models are unnecessary to ship or present as a citizen's work.

## Leave behind

Three.js scene/material loading, automatic remote resource loading, source render cameras, arbitrary
emission/transparency, and a separate loader mesh. The existing Chatdom voxel mesh and draft controller are
the real consumers. No new parsing dependency or wholesale prototype code import is needed.

## License

The primary checkout's `LICENSE:1` is MIT. Its default palette may be adapted with the copyright/license notice
and attribution, including a root `THIRD_PARTY.md` entry merged by main. Use original fixture geometry. This
study takes format facts and a coordinate technique from the three.js source; any future code adaptation
also requires the three.js MIT notice and exact source credit. No third-party code was copied by this spec.

## Study evidence

Luna/low mapped the cloned author's docs, license and exact commit; main spec author checked the relevant
files and official loader source. Terra/high reviewed coordinate/palette and import-semantics pitfalls. No
reference demo was executed: this is a file-format technique study; the visual acceptance is the actual
imported geometry in Chatdom's build surface.
