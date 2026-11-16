import { describe, expect, it } from 'vitest';
import {
  createTestingBoard,
  fakeNodeWeakMap,
  PlaitHistoryBoard,
  Transforms,
  withHistory,
} from '@plait/core';
import { createMindElement, MindElement, MindTransforms } from '@plait/mind';
import { AbstractNode, MindLayoutType } from '@plait/layouts';
import { createDrawnixEditor, parseDrawnixDocument } from './editor';

function setup() {
  const board = createTestingBoard([withHistory], []);
  const editor = createDrawnixEditor(board);
  editor.updateMindmap([
    { type: 'populate_empty', markdown: '# 核心点\n## 子节点' },
  ]);
  const id = editor.readMindmap()[0].id;
  return { board, editor, id };
}

describe('independent mind-map notes', () => {
  it('round-trips a multiline note without changing the visible topic', () => {
    const { editor, id } = setup();
    const note = '详细解释\n个人笔记 📝\nhttps://example.com';
    editor.updateMindmap([{ type: 'set_note', nodeId: id, note }]);
    const document = parseDrawnixDocument(editor.serialize());
    const reopened = createDrawnixEditor(
      createTestingBoard([], document.elements)
    );
    expect(reopened.readMindmap()[0]).toMatchObject({
      id,
      topic: '核心点',
      note,
    });
    expect(reopened.readMindmap()[0].children[0].note).toBeUndefined();
  });

  it('opens older documents without notes', () => {
    const { editor } = setup();
    const document = parseDrawnixDocument(editor.serialize());
    expect(document.elements[0].note).toBeUndefined();
    expect(editor.readMindmap()[0].topic).toBe('核心点');
  });

  it('keeps notes when renaming a node and removing an emoji', () => {
    const { board, editor, id } = setup();
    editor.updateMindmap([
      { type: 'set_note', nodeId: id, note: '保留这条笔记' },
    ]);
    editor.updateMindmap([{ type: 'set_topic', nodeId: id, topic: '新标题' }]);
    fakeNodeWeakMap(board);
    MindTransforms.addEmoji(board, board.children[0] as MindElement, {
      name: 'smile',
    });
    fakeNodeWeakMap(board);
    const node = board.children[0] as MindElement;
    if (!MindElement.hasEmojis(node)) throw new Error('Emoji was not added');
    MindTransforms.removeEmoji(board, node, node.data.emojis[0]);
    expect(editor.readMindmap()[0]).toMatchObject({
      topic: '新标题',
      note: '保留这条笔记',
    });
  });

  it('removes a note and restores it through the same undo history', () => {
    const { board, editor, id } = setup();
    editor.updateMindmap([
      { type: 'set_note', nodeId: id, note: '可撤销的笔记' },
    ]);
    editor.updateMindmap([{ type: 'set_note', nodeId: id, note: '' }]);
    expect(editor.readMindmap()[0].note).toBeUndefined();
    expect(JSON.parse(editor.serialize()).elements[0]).not.toHaveProperty(
      'note'
    );
    board.undo();
    expect(editor.readMindmap()[0].note).toBe('可撤销的笔记');
    board.redo();
    expect(editor.readMindmap()[0].note).toBeUndefined();
  });

  it('rolls back a failed batch including its note mutation', () => {
    const { board, editor, id } = setup();
    const before = editor.serialize();
    const originalApply = board.apply;
    let count = 0;
    board.apply = (operation) => {
      if (++count === 2) throw new Error('Synthetic failure');
      originalApply(operation);
    };
    expect(() =>
      editor.updateMindmap([
        { type: 'set_note', nodeId: id, note: 'Must roll back' },
        { type: 'set_topic', nodeId: id, topic: 'Must roll back' },
      ])
    ).toThrow('Synthetic failure');
    expect(editor.serialize()).toBe(before);
  });

  it('rejects a missing node before applying any part of a batch', () => {
    const { editor, id } = setup();
    const before = editor.serialize();
    expect(() =>
      editor.updateMindmap([
        { type: 'set_note', nodeId: id, note: 'Must not apply' },
        { type: 'set_note', nodeId: 'missing', note: 'Invalid target' },
      ])
    ).toThrow();
    expect(editor.serialize()).toBe(before);
  });
});

describe('inserting siblings', () => {
  function children(board: ReturnType<typeof setup>['board']) {
    return (board.children[0] as MindElement).children;
  }

  it('extends a summary that covers the node the sibling is inserted after', () => {
    const board = createTestingBoard([withHistory], []);
    const editor = createDrawnixEditor(board);
    editor.updateMindmap([
      { type: 'populate_empty', markdown: '# Root\n## A\n## B\n## C' },
    ]);
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.insertNode(
        board,
        { ...createMindElement('Summary', {}), start: 0, end: 1 },
        [0, 3]
      );
    });
    const [a, b] = editor.readMindmap()[0].children;
    const undos = board.history.undos.length;
    editor.updateMindmap([
      { type: 'insert_sibling', nodeId: a.id, topic: 'A2' },
    ]);
    const nodes = children(board);
    const summary = nodes.find((node) => AbstractNode.isAbstract(node));
    expect(summary).toMatchObject({ start: 0, end: 2 });
    expect(nodes.slice(0, 3).map((node) => node.id)).toEqual([
      a.id,
      expect.any(String),
      b.id,
    ]);
    expect(() =>
      editor.updateMindmap([
        { type: 'insert_sibling', nodeId: summary!.id, topic: 'No' },
      ])
    ).toThrow('A summary node cannot have a sibling.');
    // One undo step removes the node and restores the summary.
    expect(board.history.undos).toHaveLength(undos + 1);
    board.undo();
    expect(
      children(board).find((node) => AbstractNode.isAbstract(node))
    ).toMatchObject({ start: 0, end: 1 });
  });

  it('keeps right-side nodes on the right in a standard layout', () => {
    const board = createTestingBoard([withHistory], []);
    const editor = createDrawnixEditor(board);
    editor.updateMindmap([
      { type: 'populate_empty', markdown: '# Root\n## R1\n## R2\n## L1' },
    ]);
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(
        board,
        { layout: MindLayoutType.standard, rightNodeCount: 2 },
        [0]
      );
    });
    const [r1, r2, l1] = editor.readMindmap()[0].children;
    editor.updateMindmap([
      { type: 'insert_sibling', nodeId: r1.id, topic: 'R1b' },
    ]);
    const root = board.children[0] as MindElement;
    expect(root.rightNodeCount).toBe(3);
    const right = root.children.slice(0, root.rightNodeCount);
    expect(right.map((node) => node.id)).toContain(r2.id);
    expect(root.children[3].id).toBe(l1.id);
    // A sibling of a left-side node does not change the right side.
    editor.updateMindmap([
      { type: 'insert_sibling', nodeId: l1.id, topic: 'L2' },
    ]);
    expect((board.children[0] as MindElement).rightNodeCount).toBe(3);
  });
});
