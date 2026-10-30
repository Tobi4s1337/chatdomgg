/** Work the importer accepts before it allocates or iterates. Draft policy and shared caps can only tighten these. */
export const VOX_IMPORT_LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  chunks: 8192,
  depth: 16,
  models: 256,
  voxels: 1_048_576,
  dimension: 256,
});

export type VoxErrorCode =
  | 'too-large' | 'not-vox' | 'version' | 'truncated' | 'structure' | 'limit' | 'dimensions'
  | 'voxel' | 'duplicate' | 'empty' | 'palette-remap' | 'model' | 'materials' | 'too-detailed' | 'destination';

/** A useful failure: what happened, and what the builder can do next. */
export interface VoxImportError {
  readonly code: VoxErrorCode;
  readonly message: string;
  readonly remedy: string;
  /** Byte offset of the failing record, when the file itself is at fault. */
  readonly offset?: number;
}

export class VoxFailure extends Error {
  constructor(readonly error: VoxImportError) { super(error.message); this.name = 'VoxFailure'; }
}

export function voxFail(code: VoxErrorCode, message: string, remedy: string, offset?: number): never {
  throw new VoxFailure(offset === undefined ? { code, message, remedy } : { code, message, remedy, offset });
}

export const RESAVE = 'Open it in MagicaVoxel and save it again, then choose the new file.';
