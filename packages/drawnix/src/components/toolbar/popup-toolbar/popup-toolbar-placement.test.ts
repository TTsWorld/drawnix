import { describe, expect, it } from 'vitest';
import { createTestingBoard, fakeNodeWeakMap } from '@plait/core';
import { MIND_ELEMENT_TO_NODE, MindElement, type MindNode } from '@plait/mind';
import { createMindmapDocument } from '../../../editor';
import { getPopupToolbarPlacement } from './popup-toolbar-placement';

function setup(left: Record<string, boolean>) {
  const document = createMindmapDocument('# Root\n## A\n## B');
  const board = createTestingBoard([], document.elements);
  fakeNodeWeakMap(board);
  const root = board.children[0] as MindElement;
  const [a, b] = root.children as MindElement[];
  for (const [element, isLeft] of [
    [root, false],
    [a, left.a ?? false],
    [b, left.b ?? false],
  ] as const) {
    MIND_ELEMENT_TO_NODE.set(element, {
      origin: element,
      left: isLeft,
    } as MindNode);
  }
  return { board, root, a, b };
}

describe('popup toolbar placement', () => {
  it('opens on the right by default and for right-side nodes', () => {
    const { board, root, a } = setup({});
    expect(getPopupToolbarPlacement(board, [])).toBe('right-start');
    expect(getPopupToolbarPlacement(board, [root])).toBe('right-start');
    expect(getPopupToolbarPlacement(board, [a])).toBe('right-start');
  });

  it('opens away from the parent for nodes left of it', () => {
    const { board, a, b } = setup({ a: true });
    expect(getPopupToolbarPlacement(board, [a])).toBe('left-start');
    // Mixed sides keep the default.
    expect(getPopupToolbarPlacement(board, [a, b])).toBe('right-start');
  });

  it('falls back to the right when the node has no layout yet', () => {
    const { board, a } = setup({ a: true });
    MIND_ELEMENT_TO_NODE.delete(a);
    expect(getPopupToolbarPlacement(board, [a])).toBe('right-start');
  });
});
