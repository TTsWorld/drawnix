import { type PlaitBoard, WritableClipboardOperationType } from '@plait/core';
import { markAnkiCardsCut, prepareAnkiCardsForPaste } from '../anki-cards';

/**
 * Plait copies extra node fields on copy, cut, duplicate and paste. Copies
 * get new card IDs; a cut keeps them so the cards move with their node.
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
      clipboardData = {
        ...clipboardData,
        elements: prepareAnkiCardsForPaste(
          clipboardData.elements,
          board.children
        ),
      };
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };
  return board;
};
