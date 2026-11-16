import type { PlaitBoard, PlaitElement } from '@plait/core';
import { DOCUMENT_SIZE_LIMIT, getUtf8Size } from '../anki-card-images';
import { getDocumentSize } from '../document-size';

type Listener = (projected: number) => void;
const LISTENERS = new WeakMap<PlaitBoard, Set<Listener>>();

/**
 * Refuses a paste or duplicate (Plait runs both through insertFragment)
 * whose elements would take the document past DOCUMENT_SIZE_LIMIT, which
 * hosts such as Stair cannot save. Copying a subtree with card images is
 * the easy way to get there. Listeners (the size notice) are told the size
 * the document would have had.
 *
 * Other changes (redo, Agent commands, images pasted onto the board) are not
 * refused; DocumentSizeNotice reports the size after them.
 */
export const withDocumentSizeLimit = (board: PlaitBoard) => {
  const { insertFragment } = board;
  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    const elements = clipboardData?.elements;
    if (elements?.length) {
      const projected =
        getDocumentSize(board) + getFragmentSize(elements as PlaitElement[]);
      if (projected > DOCUMENT_SIZE_LIMIT) {
        LISTENERS.get(board)?.forEach((listener) => listener(projected));
        return;
      }
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };
  return board;
};

/** About what the elements add to the serialized document. */
export function getFragmentSize(elements: PlaitElement[]): number {
  return getUtf8Size(JSON.stringify(elements, null, 2));
}

/** Calls `listener` when a paste is refused; returns an unsubscribe. */
export function onFragmentRefused(board: PlaitBoard, listener: Listener) {
  const listeners = LISTENERS.get(board) ?? new Set<Listener>();
  listeners.add(listener);
  LISTENERS.set(board, listeners);
  return () => {
    listeners.delete(listener);
  };
}
