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
