import { type PlaitBoard, WritableClipboardOperationType } from '@plait/core';
import { markAnkiCardsCut, prepareAnkiCardsForPaste } from '../anki-cards';

// Cuts that were already pasted. Shared by every board in this page and, via
// localStorage, by other windows of the same origin and across reloads.
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

/**
 * Plait copies extra node fields on copy, cut, duplicate and paste. Copies
 * get new card IDs; the first paste of a cut keeps them so the cards move with
 * their node.
 */
export const withAnkiCards = (board: PlaitBoard) => {
  const { buildFragment, insertFragment } = board;
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
      clipboardData = {
        ...clipboardData,
        elements: prepareAnkiCardsForPaste(
          clipboardData.elements,
          board.children,
          pastedCuts
        ),
      };
      if (pastedCuts.size !== count) writePastedCuts(pastedCuts);
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };
  return board;
};
