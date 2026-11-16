// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  addSelectedElement,
  clearSelectedElement,
  createTestingBoard,
  fakeNodeWeakMap,
  type PlaitBoard,
  type PlaitElement,
  PlaitHistoryBoard,
  Transforms,
  withHistory,
  withOptions,
  withSelection,
  WritableClipboardOperationType,
} from '@plait/core';
import { withMind } from '@plait/mind';
import { DOCUMENT_SIZE_LIMIT } from '../anki-card-images';
import { getDocumentSize } from '../document-size';
import { createMindmapDocument, serializeDrawnixBoard } from '../editor';
import {
  onFragmentRefused,
  withDocumentSizeLimit,
} from './with-document-size-limit';

/** A board with Plait's real mind-map paste, without rendering. */
function setup(note: string, limit = true) {
  const document = createMindmapDocument('# Root\n## Child');
  document.elements[0].note = note;
  let board = createTestingBoard(
    [withOptions, withHistory, withSelection, withMind],
    document.elements
  );
  // Rendering (layout, selection boxes) is not part of these tests.
  board.onChange = () => fakeNodeWeakMap(board);
  board.afterChange = () => undefined;
  if (limit) board = withDocumentSizeLimit(board);
  const refused = vi.fn();
  onFragmentRefused(board, refused);
  return { board, refused };
}

function selectRoot(board: PlaitBoard) {
  fakeNodeWeakMap(board);
  clearSelectedElement(board);
  addSelectedElement(board, board.children[0]);
}

function pasteOnRoot(
  board: PlaitBoard,
  data: Parameters<PlaitBoard['insertFragment']>[0]
) {
  selectRoot(board);
  board.insertFragment(data, [0, 0], WritableClipboardOperationType.paste);
}

/** A mind map with many lines once serialized: one per card field. */
function fragmentWithManyLines(): PlaitElement[] {
  const element = createMindmapDocument('# Pasted\n## Inner')
    .elements[0] as PlaitElement;
  element.children[0].ankiCards = Array.from({ length: 2000 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    front: 'f',
    back: 'b',
  }));
  return [element];
}

describe('document size limit on paste', () => {
  it('pastes text onto a selected node when the document stays in the limit', () => {
    const { board, refused } = setup('');
    pasteOnRoot(board, { text: 'Pasted text' });
    expect(board.children[0].children).toHaveLength(2);
    expect(refused).not.toHaveBeenCalled();
    board.undo();
    expect(board.children[0].children).toHaveLength(1);
  });

  it('refuses plain text pasted onto a node when it would go over the limit', () => {
    const { board, refused } = setup('x'.repeat(DOCUMENT_SIZE_LIMIT - 4096));
    const before = serializeDrawnixBoard(board);
    const undos = [...board.history.undos];
    pasteOnRoot(board, { text: 'y'.repeat(8192) });
    expect(serializeDrawnixBoard(board)).toBe(before);
    expect(board.history.undos).toEqual(undos);
    expect(board.history.redos).toEqual([]);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0][0]).toBeGreaterThan(DOCUMENT_SIZE_LIMIT);
  });

  it('measures pasted nodes where they end up, nested and indented', () => {
    // How much the fragment adds when pasted under a node, without a limit.
    const probe = setup('').board;
    const empty = getDocumentSize(probe);
    pasteOnRoot(probe, { elements: fragmentWithManyLines() });
    const added = getDocumentSize(probe) - empty;
    // Serialized at the root, the fragment looks smaller than it ends up.
    const atRoot = new TextEncoder().encode(
      JSON.stringify(fragmentWithManyLines(), null, 2)
    ).length;
    expect(added).toBeGreaterThan(atRoot + 1000);

    // Fits by the root estimate, but not once nested.
    const padding = DOCUMENT_SIZE_LIMIT - empty - atRoot - 100;
    const { board, refused } = setup('x'.repeat(padding));
    const before = serializeDrawnixBoard(board);
    pasteOnRoot(board, { elements: fragmentWithManyLines() });
    expect(serializeDrawnixBoard(board)).toBe(before);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0][0]).toBe(empty + padding + added);
  });

  it('leaves an earlier change in the same undo step when rolling back', () => {
    const { board } = setup('x'.repeat(DOCUMENT_SIZE_LIMIT - 4096));
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { note: 'short' }, [0, 0]);
    });
    // Still pending: Plait adds the paste to the same batch.
    expect(board.operations).not.toHaveLength(0);
    const batch = board.history.undos[board.history.undos.length - 1];
    const length = batch.length;
    pasteOnRoot(board, { text: 'y'.repeat(8192) });
    expect(board.history.undos[board.history.undos.length - 1]).toBe(batch);
    expect(batch).toHaveLength(length);
    board.undo();
    expect(board.children[0].children[0].note).toBeUndefined();
    expect(board.children[0].children).toHaveLength(1);
  });
});
