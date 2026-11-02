# Reference: binary greedy meshing for exact shadow surfaces

Source: https://github.com/cgerikj/binary-greedy-meshing · MIT · studied at `af8c688`.
For: GW10 static building shadow cost, under spec 56's quality and source-lattice invariants.

The implementation represents visible voxel faces as bit masks and greedily merges their rectangles.
`src/mesher.h:116–134` constructs orientation masks, `136–199` merges four orientations, and
`208–271` handles the remaining pair. Sparse empty rows cost little and integer masks make holes explicit.

We take the bounded row-mask representation and deterministic rectangle growth. Our chunks use 32-cell
rows, six orientations and 33 possible corner planes: 25,344 bytes of scratch. JavaScript bitwise results
must be normalised to unsigned values when bit 31 is set. A first count pass bounds allocation; if greedy
repartitioning would increase the quad count, retain the original opaque rectangles.

Our input is the existing emitted colour mesh, not a second occupancy raster. This distinction preserves
hidden faces around glass, ordered carves and chunk boundaries exactly. Only emitted glass faces are
discarded, matching the native shadow fragment shader. Material, ambient-occlusion and sky-light seams
can disappear from opaque depth geometry without changing its oriented unit-face union. The original
colour mesh, physical source and native vertex transform remain intact.

We leave behind the reference's 64-bit chunk layout, vertex pulling, GPU-specific assumptions and
occupancy-based visibility pass. Deforming foliage and royal shaders are ineligible. This is independently
written TypeScript informed by the algorithm; no source code or assets were copied. The source license
credits Erik Johansson, 2020.
