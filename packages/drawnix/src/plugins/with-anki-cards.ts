import type { PlaitBoard } from '@plait/core';
import { renewDuplicateAnkiCardIds } from '../anki-cards';

/** Plait copies extra node fields on paste/duplicate; keep card IDs unique. */
export const withAnkiCards = (board: PlaitBoard) => {
  const { insertFragment } = board;
  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    if (clipboardData?.elements?.length) {
      clipboardData = {
        ...clipboardData,
        elements: renewDuplicateAnkiCardIds(
          clipboardData.elements,
          board.children
        ),
      };
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };
  return board;
};
