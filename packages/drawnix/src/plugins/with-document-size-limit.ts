import {
  deleteTemporaryElements,
  getTemporaryRef,
  type PlaitBoard,
  PlaitHistoryBoard,
  PlaitOperation,
} from '@plait/core';
import { DOCUMENT_SIZE_LIMIT } from '../anki-card-images';
import { getDocumentSize } from '../document-size';

type Listener = (size: number) => void;
const LISTENERS = new WeakMap<PlaitBoard, Set<Listener>>();

/**
 * Refuses a paste or duplicate (Plait runs both through insertFragment)
 * that would take the document past DOCUMENT_SIZE_LIMIT, which hosts such
 * as Stair cannot save. Copying a subtree with card images is the easy way
 * to get there. Listeners (the size notice) are told the size the document
 * would have had.
 *
 * The paste is applied and the saved document measured; one over the limit
 * is rolled back, leaving the document and history as they were. Measuring
 * the result rather than the clipboard covers plain text pasted onto a node
 * (no `elements`), the deeper indentation of nodes pasted under a node, and
 * card IDs renewed while pasting.
 *
 * Other changes (redo, Agent commands, images read asynchronously after a
 * paste) are not refused; DocumentSizeNotice reports the size after them.
 */
export const withDocumentSizeLimit = (board: PlaitBoard) => {
  const { insertFragment } = board;
  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    const { history } = board;
    const undos = [...history.undos];
    const redos = [...history.redos];
    // Plait adds operations to the last batch while a change is pending.
    const lastBatch = undos[undos.length - 1];
    const lastBatchLength = lastBatch?.length;
    const temporaryRef = getTemporaryRef(board);
    const operationCount = board.operations.length;
    const applied: PlaitOperation[] = [];
    const { apply } = board;
    board.apply = (operation) => {
      apply(operation);
      applied.push(operation);
    };
    try {
      insertFragment(clipboardData, targetPoint, operationType);
    } finally {
      board.apply = apply;
    }
    if (!applied.some((operation) => operation.type !== 'set_selection')) {
      return;
    }
    const size = getDocumentSize(board);
    if (size <= DOCUMENT_SIZE_LIMIT) return;

    PlaitHistoryBoard.withoutSaving(board, () => {
      for (const operation of applied.map(PlaitOperation.inverse).reverse()) {
        board.apply(operation);
      }
    });
    history.undos = undos;
    history.redos = redos;
    // The paste and its rollback cancel out. Keep them out of the pending
    // change, so the host's onChange does not see an edit and mark the
    // document modified.
    board.operations.splice(operationCount);
    if (lastBatch && lastBatchLength !== undefined) {
      lastBatch.length = lastBatchLength;
    }
    // Pasted mind-map nodes are selected once rendered; they are gone.
    const pastedRef = getTemporaryRef(board);
    if (pastedRef && pastedRef !== temporaryRef) {
      clearTimeout(pastedRef.timeoutId);
      deleteTemporaryElements(board);
    }
    LISTENERS.get(board)?.forEach((listener) => listener(size));
  };
  return board;
};

/** Calls `listener` when a paste is refused; returns an unsubscribe. */
export function onFragmentRefused(board: PlaitBoard, listener: Listener) {
  const listeners = LISTENERS.get(board) ?? new Set<Listener>();
  listeners.add(listener);
  LISTENERS.set(board, listeners);
  return () => {
    listeners.delete(listener);
  };
}
