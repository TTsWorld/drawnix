import { describe, expect, it, vi } from 'vitest';
import {
  createTestingBoard,
  fakeNodeWeakMap,
  PlaitBoard,
  type PlaitElement,
  PlaitHistoryBoard,
  Transforms,
  withHistory,
  WritableClipboardOperationType,
} from '@plait/core';
import { copyNewNode, MindElement, MindTransforms } from '@plait/mind';
import {
  createAnkiCardId,
  getAnkiCards,
  getMindmapAnkiCards,
  parseAnkiTags,
  renewDuplicateAnkiCardIds,
} from './anki-cards';
import { createDrawnixEditor, parseDrawnixDocument } from './editor';
import { withAnkiCards } from './plugins/with-anki-cards';

const card = (id: string, front = `Q ${id}`, back = `A ${id}`) => ({
  id,
  front,
  back,
});

function setup() {
  const board = createTestingBoard([withHistory], []);
  const editor = createDrawnixEditor(board);
  editor.updateMindmap([
    { type: 'populate_empty', markdown: '# 核心点\n## 子节点 A\n## 子节点 B' },
  ]);
  const outline = editor.readMindmap()[0];
  return {
    board,
    editor,
    rootId: outline.id,
    childIds: outline.children.map((child) => child.id),
  };
}

function setCards(board: PlaitBoard, path: number[], cards: unknown[]) {
  fakeNodeWeakMap(board);
  PlaitHistoryBoard.withNewBatch(board, () => {
    Transforms.setNode(board, { ankiCards: cards }, path);
  });
}

describe('Anki card data', () => {
  it('creates distinct UUID-shaped card IDs', () => {
    const ids = new Set(Array.from({ length: 200 }, createAnkiCardId));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    }
  });

  it('parses whitespace-separated tags without duplicates', () => {
    expect(parseAnkiTags('  math  algebra\nmath ')).toEqual([
      'math',
      'algebra',
    ]);
    expect(parseAnkiTags('   ')).toEqual([]);
  });

  it('ignores malformed cards from external edits', () => {
    expect(
      getAnkiCards({
        id: 'n',
        ankiCards: [
          null,
          { front: 'no id' },
          { id: 'a', front: 1, back: 'B', tags: ['x', 2, ''] },
          { id: 'b', front: 'F', back: 'B', tags: [] },
        ],
      } as PlaitElement)
    ).toEqual([
      { id: 'a', front: '', back: 'B', tags: ['x'] },
      { id: 'b', front: 'F', back: 'B' },
    ]);
    expect(getAnkiCards({ id: 'n', ankiCards: 'oops' } as PlaitElement)).toEqual(
      []
    );
  });

  it('reads every node with cards in document order, including image references', () => {
    const { board, editor, rootId, childIds } = setup();
    setCards(board, [0, 1], [card('b1')]);
    setCards(board, [0], [card('r1'), { ...card('r2'), tags: ['t'] }]);
    fakeNodeWeakMap(board);
    Transforms.setNode(
      board,
      {
        data: {
          ...(board.children[0] as MindElement).data,
          image: { url: 'https://example.com/a.png', width: 120, height: 80 },
        },
      },
      [0]
    );
    expect(editor.readAnkiCards()).toEqual([
      {
        nodeId: rootId,
        topic: '核心点',
        image: { url: 'https://example.com/a.png', width: 120, height: 80 },
        cards: [card('r1'), { ...card('r2'), tags: ['t'] }],
      },
      { nodeId: childIds[1], topic: '子节点 B', cards: [card('b1')] },
    ]);
  });

  it('round-trips cards through serialization', () => {
    const { board, editor, childIds } = setup();
    setCards(board, [0, 0], [{ ...card('a1', '正面\n第二行'), tags: ['x'] }]);
    const document = parseDrawnixDocument(editor.serialize());
    expect(getMindmapAnkiCards(document.elements)).toEqual([
      {
        nodeId: childIds[0],
        topic: '子节点 A',
        cards: [{ ...card('a1', '正面\n第二行'), tags: ['x'] }],
      },
    ]);
    // Documents without cards need no migration.
    expect(document.elements[0]).not.toHaveProperty('ankiCards');
  });

  it('keeps cards independent of the node title, note and emojis', () => {
    const { board, editor, rootId } = setup();
    setCards(board, [0], [card('r1', '原标题', '原附注')]);
    editor.updateMindmap([
      { type: 'set_topic', nodeId: rootId, topic: '新标题' },
      { type: 'set_note', nodeId: rootId, note: '新附注' },
    ]);
    fakeNodeWeakMap(board);
    MindTransforms.addEmoji(board, board.children[0] as MindElement, {
      name: 'smile',
    });
    fakeNodeWeakMap(board);
    const node = board.children[0] as MindElement;
    if (!MindElement.hasEmojis(node)) throw new Error('Emoji was not added');
    MindTransforms.removeEmoji(board, node, node.data.emojis[0]);
    expect(editor.readAnkiCards()[0]).toMatchObject({
      topic: '新标题',
      cards: [card('r1', '原标题', '原附注')],
    });
  });

  it('removes and restores cards with the node through undo/redo', () => {
    const { board, editor } = setup();
    setCards(board, [0, 0], [card('a1')]);
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.removeNode(board, [0, 0]);
    });
    expect(editor.readAnkiCards()).toEqual([]);
    board.undo();
    expect(editor.readAnkiCards()[0].cards).toEqual([card('a1')]);
    board.redo();
    expect(editor.readAnkiCards()).toEqual([]);
  });
});

describe('Anki card IDs on paste', () => {
  it('renews IDs already on the board, recursively and within one paste', () => {
    const { board } = setup();
    setCards(board, [0, 0], [card('a1'), card('a2')]);
    const source = board.children[0] as MindElement;
    const copy = copyNewNode(source);
    const pasted = renewDuplicateAnkiCardIds([copy, copy], board.children);
    const ids = pasted.flatMap((root) =>
      getMindmapAnkiCards([root]).flatMap((node) =>
        node.cards.map((item) => item.id)
      )
    );
    expect(ids).toHaveLength(4);
    expect(new Set([...ids, 'a1', 'a2']).size).toBe(6);
    // Content is kept; the source and clipboard data are not mutated.
    expect(getMindmapAnkiCards(pasted)[0].cards.map((c) => c.front)).toEqual([
      'Q a1',
      'Q a2',
    ]);
    expect(getAnkiCards(copy.children[0])).toEqual([card('a1'), card('a2')]);
  });

  it('keeps IDs of cut nodes that are no longer on the board', () => {
    const { board } = setup();
    setCards(board, [0, 0], [card('a1')]);
    const cut = copyNewNode(board.children[0] as MindElement);
    fakeNodeWeakMap(board);
    Transforms.removeNode(board, [0]);
    const [pasted] = renewDuplicateAnkiCardIds([cut], board.children);
    expect(getAnkiCards((pasted as MindElement).children[0])).toEqual([
      card('a1'),
    ]);
  });

  it('applies to clipboard elements before Plait inserts them', () => {
    const { board } = setup();
    setCards(board, [0, 1], [card('b1')]);
    const insertFragment = vi.fn();
    board.insertFragment = insertFragment;
    withAnkiCards(board);
    const child = (board.children[0] as MindElement).children[1];
    board.insertFragment(
      { elements: [copyNewNode(child)], text: 'x' },
      [0, 0],
      WritableClipboardOperationType.duplicate
    );
    const [data, point, type] = insertFragment.mock.calls[0];
    expect(point).toEqual([0, 0]);
    expect(type).toBe(WritableClipboardOperationType.duplicate);
    expect(data.text).toBe('x');
    const [pastedCard] = getAnkiCards(data.elements[0]);
    expect(pastedCard).toMatchObject({ front: 'Q b1', back: 'A b1' });
    expect(pastedCard.id).not.toBe('b1');
  });
});
