import {
  type PlaitBoard,
  type PlaitElement,
  PlaitHistoryBoard,
  Transforms,
  WritableClipboardOperationType,
} from '@plait/core';
import {
  collectAnkiCardIds,
  findDuplicateAnkiCardIds,
  markAnkiCardsCut,
  prepareAnkiCardsForPaste,
} from '../anki-cards';

// Cuts whose card IDs are in use: the first paste of a cut keeps the IDs
// (the cards moved), later pastes renew them. Shared by every board in this
// page and, via localStorage, by other windows of the same origin and across
// reloads.
const PASTED_CUTS_KEY = 'drawnix-anki-pasted-cuts';
const MAX_PASTED_CUTS = 100;
let pastedCutsInMemory: string[] = [];

function readPastedCuts(): Set<string> {
  const cuts = new Set(pastedCutsInMemory);
  try {
    const stored: unknown = JSON.parse(
      globalThis.localStorage?.getItem(PASTED_CUTS_KEY) ?? '[]'
    );
    if (Array.isArray(stored)) {
      stored.forEach((cut) => typeof cut === 'string' && cuts.add(cut));
    }
  } catch {
    // Storage may be unavailable or hold invalid data; memory still applies.
  }
  return cuts;
}

function writePastedCuts(cuts: Set<string>) {
  pastedCutsInMemory = Array.from(cuts).slice(-MAX_PASTED_CUTS);
  try {
    globalThis.localStorage?.setItem(
      PASTED_CUTS_KEY,
      JSON.stringify(pastedCutsInMemory)
    );
  } catch {
    // Keep the in-memory record only.
  }
}

function cardIdsOf(element: PlaitElement): Set<string> {
  return collectAnkiCardIds([element], new Set());
}

/**
 * Keeps card IDs unique and stable:
 *
 * - Copy, cut, duplicate and paste: copies get new card IDs; the first paste
 *   of a cut keeps them so the cards move with their node. That first paste
 *   is tied to this board's history: undoing it frees the cut again (the
 *   next paste is still the same move and keeps the IDs), redoing it uses
 *   the cut again.
 * - Duplicate card IDs in the document (older data, upstream Drawnix,
 *   host edits) are repaired after loading and after every change, without
 *   adding an undo step. See findDuplicateAnkiCardIds.
 */
export const withAnkiCards = (board: PlaitBoard) => {
  const { buildFragment, insertFragment, apply, undo, redo, afterChange } =
    board;
  // Card ID → cut ID, for cards whose IDs a cut's first paste kept here.
  const keptByCut = new Map<string, string>();
  let replaying = false;

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
    if (
      operationType === WritableClipboardOperationType.cut &&
      Array.isArray(context?.elements)
    ) {
      return { ...context, elements: markAnkiCardsCut(context.elements) };
    }
    return context;
  };

  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    if (clipboardData?.elements?.length) {
      const pastedCuts = readPastedCuts();
      const count = pastedCuts.size;
      const kept = new Map<string, string>();
      clipboardData = {
        ...clipboardData,
        elements: prepareAnkiCardsForPaste(
          clipboardData.elements,
          board.children,
          pastedCuts,
          kept
        ),
      };
      kept.forEach((cutId, cardId) => keptByCut.set(cardId, cutId));
      if (pastedCuts.size !== count) writePastedCuts(pastedCuts);
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };

  // While undo/redo replays operations, a cut's kept cards leaving the board
  // free the cut; coming back uses it again.
  board.apply = (operation) => {
    if (
      replaying &&
      keptByCut.size &&
      (operation.type === 'insert_node' || operation.type === 'remove_node')
    ) {
      const cuts = new Set<string>();
      cardIdsOf(operation.node).forEach((cardId) => {
        const cutId = keptByCut.get(cardId);
        if (cutId) cuts.add(cutId);
      });
      if (cuts.size) {
        const pastedCuts = readPastedCuts();
        cuts.forEach((cutId) =>
          operation.type === 'remove_node'
            ? pastedCuts.delete(cutId)
            : pastedCuts.add(cutId)
        );
        writePastedCuts(pastedCuts);
      }
    }
    apply(operation);
  };
  const replay = (run: () => void) => () => {
    replaying = true;
    try {
      run();
    } finally {
      replaying = false;
    }
  };
  if (undo) board.undo = replay(undo);
  if (redo) board.redo = replay(redo);

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
    scheduleRepair();
  };
  // Documents passed in at creation have no change notification.
  scheduleRepair();
  return board;
};

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
