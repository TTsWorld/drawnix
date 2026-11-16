import { describe, expect, it, vi } from 'vitest';
import {
  createTestingBoard,
  fakeNodeWeakMap,
  PlaitHistoryBoard,
  Transforms,
  withHistory,
} from '@plait/core';
import * as ankiCards from '../anki-cards';
import { createDrawnixEditor } from '../editor';
import { withAnkiCards } from './with-anki-cards';

vi.mock('../anki-cards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../anki-cards')>();
  return {
    ...actual,
    findDuplicateAnkiCardIds: vi.fn(actual.findDuplicateAnkiCardIds),
  };
});

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('duplicate card ID repair after changes', () => {
  it('skips the document scan when only the viewport, selection or theme changed', async () => {
    const board = createTestingBoard([withHistory], []);
    createDrawnixEditor(board).updateMindmap([
      { type: 'populate_empty', markdown: '# R\n## A' },
    ]);
    withAnkiCards(board);
    await flush();
    const scan = vi.mocked(ankiCards.findDuplicateAnkiCardIds);
    scan.mockClear();

    Transforms.setViewport(board, { zoom: 2, origination: [1, 1] });
    Transforms.setSelection(board, { anchor: [0, 0], focus: [0, 0] });
    board.apply({
      type: 'set_theme',
      properties: board.theme,
      newProperties: { ...board.theme, themeColorMode: 'dark' as never },
    });
    await flush();
    await flush();
    expect(scan).not.toHaveBeenCalled();

    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { note: 'n' }, [0]);
    });
    await flush();
    await flush();
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
