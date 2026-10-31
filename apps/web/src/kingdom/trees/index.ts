// Picture trees (spec 47): the grove on the kingdom's existing planting sites, and the quiet wind in its crowns.
export { plantGrove, plantTree, siteSpecies, toGroundPiece, groveBatches, ELDER_SHARE, TREE_SINK, TREE_ZONES, type GroveTree, type TreeSite, type TreeZone } from './plant';
export { attachCanopy, canopyAttributes, canopyOffset, canopyVertexShader, createCanopyMaterial, installCanopyUniforms, CANOPY_VERTEX_ANCHOR } from './canopy';
export { createPictureTree, selectTree, allPictureTrees, TREE_SPECIES, TREE_STYLES, TREE_VARIANTS, treeBlueprints, treeId, type CanopyMotion, type PictureTree, type StyleFamily, type TreeSpecies } from '@chatdom/content/trees';
