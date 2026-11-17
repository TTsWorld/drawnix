import {
  type PlaitBoard,
  PlaitHistoryBoard,
  PlaitOperation,
  Transforms,
  WritableClipboardOperationType,
} from '@plait/core';
import {
  createAnkiCardId,
  findDuplicateAnkiCardIds,
  markAnkiCardsCut,
  prepareAnkiCardsForPaste,
} from '../anki-cards';
import { onDocumentSwap } from './with-document-swap';

/**
 * Keeps card IDs unique and stable:
 *
 * - Copy, duplicate and paste: copies get new card IDs.
 * - Cut and paste on the same board moves the cards and keeps their IDs,
 *   as long as the step that removed the cut source is in this board's undo
 *   history (the source is gone) and the IDs are not on the board. Pasting a
 *   cut into another board, another window or after a reload renews the
 *   IDs like a copy. So does pasting after the host swapped the document
 *   on this board (withDocumentSwap clears the history). A cut's IDs
 *   therefore never leave the document they were made in, so no undo, redo
 *   or older history step of either document can make two documents share
 *   an Anki GUID, and nothing has to be shared between boards or stored.
 * - Duplicate card IDs in the document (older data, upstream Drawnix,
 *   host edits, undo/redo across a move) are repaired after loading and
 *   after every change, without adding an undo step. See
 *   findDuplicateAnkiCardIds.
 */
export const withAnkiCards = (board: PlaitBoard) => {
  const { buildFragment, deleteFragment, insertFragment, afterChange } = board;
  // The cuts whose source removal is in each history batch. Weak, so a batch
  // that falls out of history takes its cuts with it.
  const cutsByBatch = new WeakMap<PlaitOperation[], Set<string>>();
  let pendingCut: string | null = null;

  board.buildFragment = (
    clipboardContext,
    rectangle,
    operationType,
    originData
  ) => {
    const context = buildFragment(
      clipboardContext,
      rectangle,
      operationType,
      originData
    );
    pendingCut = null;
    if (
      operationType === WritableClipboardOperationType.cut &&
      Array.isArray(context?.elements)
    ) {
      const cutId = createAnkiCardId();
      const elements = markAnkiCardsCut(context.elements, cutId);
      if (elements.some((element, i) => element !== context.elements[i])) {
        pendingCut = cutId;
      }
      return { ...context, elements };
    }
    return context;
  };

  // Plait removes the cut elements right after building the fragment.
  board.deleteFragment = (elements) => {
    deleteFragment(elements);
    const undos = board.history?.undos;
    const batch = undos?.[undos.length - 1];
    if (pendingCut && batch) {
      cutsByBatch.set(
        batch,
        (cutsByBatch.get(batch) ?? new Set()).add(pendingCut)
      );
    }
    pendingCut = null;
  };

  /** Whether the source of this cut is removed by a step in the undo history. */
  const isMove = (cutId: string) =>
    !!board.history?.undos.some((batch) => cutsByBatch.get(batch)?.has(cutId));

  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    if (clipboardData?.elements?.length) {
      clipboardData = {
        ...clipboardData,
        elements: prepareAnkiCardsForPaste(
          clipboardData.elements,
          board.children,
          isMove
        ),
      };
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };

  let repairScheduled = false;
  const scheduleRepair = () => {
    if (repairScheduled) return;
    repairScheduled = true;
    // After Plait finishes the current change; never inside its flush.
    queueMicrotask(() => {
      repairScheduled = false;
      repairDuplicateAnkiCardIds(board);
    });
  };
  board.afterChange = () => {
    afterChange();
    // Panning, zooming and selecting change no elements: skip the full scan.
    const { operations } = board;
    if (operations?.length && operations.every(changesNoElements)) return;
    scheduleRepair();
  };
  // Documents passed in at creation have no change notification.
  scheduleRepair();
  // A swapped-in document may come without any operation to notify about.
  // Swapping also clears the history, which forgets the cuts made in the
  // previous document (see withDocumentSwap).
  onDocumentSwap(board, () => {
    pendingCut = null;
    scheduleRepair();
  });
  return board;
};

function changesNoElements(operation: PlaitOperation): boolean {
  return (
    PlaitOperation.isSetViewportOperation(operation) ||
    PlaitOperation.isSetSelectionOperation(operation) ||
    PlaitOperation.isSetThemeOperation(operation)
  );
}

/**
 * Writes the repair of duplicate card IDs back to the document. It is not
 * an undo step: undo cannot bring the duplicates back for good, because a
 * restored duplicate is repaired again to the same derived ID.
 */
export function repairDuplicateAnkiCardIds(board: PlaitBoard): boolean {
  const fixes = findDuplicateAnkiCardIds(board.children);
  if (!fixes.length) return false;
  PlaitHistoryBoard.withoutSaving(board, () => {
    for (const fix of fixes) {
      Transforms.setNode(board, { ankiCards: fix.ankiCards }, fix.path);
    }
  });
  return true;
}
