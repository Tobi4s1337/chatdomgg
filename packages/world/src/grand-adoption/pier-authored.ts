import { compilePlacedSolids } from '@chatdom/voxel/collision';
import { clearPierBounds, preparePierSites } from './pier-sites-geometry';
import { authoredHeader, AuthoredPierError, deny, freezeDetached } from './pier-authored-checks';
import { authoredCollision, walkAuthoredPier } from './pier-authored-physics';
import { authoredWaters } from './pier-authored-water';
import { AUTHORED_PIER_BUDGET as B, type AuthoredPierCertificate, type AuthoredPierContext, type AuthoredPierProposal, type AuthoredPierResult, type AuthoredPierWork } from './pier-authored-types';

export * from './pier-authored-types';
/** Validate one actual authored installation. No searching, geometry repair, terrain edits or publication.
 * Base collision owns all unknown-space barriers. Candidate ordered-write interiors add only actual solids.
 * Success is a detached frozen local certificate, not a founded receipt or a grant to walk before installation. */
export function validateAuthoredPier(context: AuthoredPierContext, proposal: AuthoredPierProposal,
  options: { readonly pinned?: AuthoredPierCertificate } = {}): AuthoredPierResult {
  const work: AuthoredPierWork = { candidates: 0, preparationChecks: 0, groundSamples: 0, waterSamples: 0,
    coverageQueries: 0, collisionQueries: 0, collisionBoxes: 0, exclusionChecks: 0, proposalBytes: 0,
    blueprintCells: 0, writeCells: 0, compiledBoxes: 0, movementTicks: 0, overlayBoxChecks: 0 };
  try {
    const header = authoredHeader(proposal, work);
    proposal = header.proposal;
    if (context.scene.materials.materials.length > 256) deny('budget-exceeded', { stage: 'header' });
    const semantics = context.scene.materials.materials.map(m => [m.id, m.solid] as const).sort((a, b) => a[0] - b[0]);
    const geometryKey = `authored-pier:1:${header.identity}:solids:${JSON.stringify(semantics)}`;
    if (options.pinned && options.pinned.geometryKey !== geometryKey) deny('pinned-mismatch', { stage: 'pin' });
    const prepared = preparePierSites(context);
    Object.assign(work, prepared.work);
    if (prepared.failure) deny(prepared.failure, { stage: 'exclusion' });
    const collision = context.collision!, layoutRevision = context.scene.layoutRevision, collisionRevision = context.scene.collisionRevision;
    const p = { ...prepared, work }; work.candidates = 1;
    for (const piece of header.pieces) {
      const excluded = clearPierBounds(p, piece.world);
      if (excluded) deny(excluded, { stage: 'exclusion', pieceId: piece.id });
    }
    const base = authoredCollision(collision, [], work);
    const anchor = authoredWaters(context, proposal, header, base, work);
    if (options.pinned && (options.pinned.anchor.id !== anchor.id || options.pinned.anchor.turn !== anchor.turn
      || options.pinned.anchor.waterY !== anchor.waterY || options.pinned.anchor.water !== anchor.water || options.pinned.anchor.biome !== anchor.biome
      || options.pinned.anchor.root.some((n, i) => n !== anchor.root[i]) || options.pinned.anchor.depth.length !== anchor.depth.length
      || options.pinned.anchor.depth.some((n, i) => n !== anchor.depth[i]))) deny('pinned-mismatch', { stage: 'pin' });
    let boxes;
    try {
      boxes = compilePlacedSolids({ materials: { materials: semantics.map(([id, solid]) => ({ id, solid })) },
        assets: proposal.pieces.map(piece => ({ assetHash: piece.id, blueprint: piece.blueprint })),
        placements: proposal.pieces.map(piece => ({ id: piece.id, assetHash: piece.id, position: piece.position, rotation: piece.rotation })),
      }, { assets: B.pieces, placements: B.pieces, materials: 256, cells: B.blueprintCells, writes: B.blueprintWrites, writeCells: B.writeCells, boxes: B.compiledBoxes });
    } catch (error) {
      deny(error instanceof RangeError ? 'budget-exceeded' : 'compile-failed', { stage: 'compile' });
    }
    work.compiledBoxes = boxes.length;
    // This overlay wraps the original base, not the counting wrapper: each query and barrier is owned once.
    const overlay = authoredCollision(collision, boxes, work);
    walkAuthoredPier(overlay, proposal, work);
    const certificate: AuthoredPierCertificate = freezeDetached({ version: 1, proposal,
      anchor: { ...anchor, root: [...anchor.root] as [number, number, number], depth: [...anchor.depth] }, geometryKey,
      layoutRevision, collisionRevision });
    return Object.freeze({ ok: true, certificate, work: Object.freeze(work) });
  } catch (error) {
    if (error instanceof AuthoredPierError) return Object.freeze({ ok: false, reason: error.reason, detail: freezeDetached({ ...error.detail,
      ...(error.detail.at ? { at: [...error.detail.at] as [number, number, number] } : {}) }), work: Object.freeze(work) });
    // A provider exception or malformed untyped proposal is not evidence that land is safe.
    return Object.freeze({ ok: false, reason: 'invalid-proposal', detail: Object.freeze({ stage: 'header' }), work: Object.freeze(work) });
  }
}
