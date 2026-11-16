import type { PlaitElement } from '@plait/core';

/**
 * Finds an element by ID anywhere in the document tree, including inside
 * collapsed mind-map branches. Plait's findElements follows
 * `board.isRecursion`, which withMind turns off for collapsed nodes because
 * their children are not rendered; document commands and panels address
 * nodes by ID regardless of what is shown.
 */
export function findElementById(
  elements: PlaitElement[],
  id: string
): PlaitElement | undefined {
  for (const element of elements) {
    if (!element) continue;
    if (element.id === id) return element;
    if (Array.isArray(element.children)) {
      const found = findElementById(element.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Path of the element with this ID in the document tree. Unlike
 * `PlaitBoard.findPath`, this does not depend on the node-to-path maps that
 * rendering keeps: nodes in a collapsed branch are not rendered, so a node
 * object created there (by editing it) has no entry until it is shown again.
 */
export function findElementPathById(
  elements: PlaitElement[],
  id: string
): number[] | undefined {
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (!element) continue;
    if (element.id === id) return [index];
    if (Array.isArray(element.children)) {
      const path = findElementPathById(element.children, id);
      if (path) return [index, ...path];
    }
  }
  return undefined;
}
