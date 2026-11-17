import type { Placement } from '@floating-ui/react';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import { MindElement, PlaitMind } from '@plait/mind';

function isLeftOfParent(board: PlaitBoard, element: PlaitElement): boolean {
  if (!MindElement.isMindElement(board, element) || PlaitMind.isMind(element)) {
    return false;
  }
  try {
    return MindElement.getNode(element).left;
  } catch {
    // No layout yet; keep the default side.
    return false;
  }
}

/**
 * The toolbar normally opens to the right of the selection. A mind-map node
 * laid out to the left of its parent has the parent on that side, so the
 * toolbar would cover the parent node (and clicks meant for it would hit the
 * toolbar). Open it on the left instead, away from the parent.
 */
export function getPopupToolbarPlacement(
  board: PlaitBoard,
  elements: PlaitElement[]
): Placement {
  const allLeftOfParent =
    elements.length > 0 &&
    elements.every((element) => isLeftOfParent(board, element));
  return allLeftOfParent ? 'left-start' : 'right-start';
}
