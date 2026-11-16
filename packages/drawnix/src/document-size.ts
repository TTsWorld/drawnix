// Size of the saved document. Hosts such as Stair reject documents above
// DOCUMENT_SIZE_LIMIT, and card images make it easy to get there.
import type { PlaitBoard } from '@plait/core';
import { getUtf8Size } from './anki-card-images';
import { serializeDrawnixBoard } from './editor';

/** Bytes of the document as `editor.serialize()` returns it. */
export function getDocumentSize(board: PlaitBoard): number {
  return getUtf8Size(serializeDrawnixBoard(board));
}
