import type { CitizenLook } from '../../../../packages/content/src/avatar-style';
import { PIECE_CARDS, pieceCard, type PieceCard, type PieceKind } from '../../../../packages/content/src/avatar-style/character/pieces';
import { checkHarmful } from '../../../../packages/content/src/avatar-style/character/safety';

/*
 * The content package's piece cards and its harmful-combination check, as the builder reads them. Names and stories
 * live in content; the builder never words a piece itself.
 */

export type { PieceCard, PieceKind };

export function pieceCardFor(kind: PieceKind, id: string): PieceCard | null {
  return pieceCard(kind, id) ?? null;
}

/** Every piece that has a card. */
export function allPieceCards(): readonly PieceCard[] { return PIECE_CARDS; }

/** What makes a look unfit to walk the streets, in sentences for the person; empty when it may be saved. */
export function harmfulReasons(look: CitizenLook): readonly string[] { return checkHarmful(look); }
