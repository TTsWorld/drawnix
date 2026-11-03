import { describe, expect, it } from 'vitest';
import { createTestingBoard, fakeNodeWeakMap, withHistory } from '@plait/core';
import { MindElement, MindTransforms } from '@plait/mind';
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
