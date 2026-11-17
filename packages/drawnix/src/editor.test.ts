import { describe, expect, it } from 'vitest';
import {
  createTestingBoard,
  PlaitBoard,
  fakeNodeWeakMap,
  PlaitHistoryBoard,
  Transforms,
  withHistory,
} from '@plait/core';
import { createMindElement, MindElement, MindTransforms } from '@plait/mind';
import { AbstractNode, MindLayoutType } from '@plait/layouts';
import {
  createDrawnixEditor,
  createMindmapDocument,
  getMindmapOutline,
  type MindmapNode,
  type MindmapOperation,
  parseDrawnixDocument,
} from './editor';

function setup(markdown = '# 核心点\n## 子节点') {
  const board = createTestingBoard([withHistory], []);
  const editor = createDrawnixEditor(board);
  editor.updateMindmap([{ type: 'populate_empty', markdown }]);
  const id = editor.readMindmap()[0].id;
  return { board, editor, id };
}

/** Makes the board's second applied operation throw; returns the real apply. */
function failSecondApply(board: PlaitBoard) {
  const originalApply = board.apply;
  let count = 0;
  board.apply = (operation) => {
    if (++count === 2) throw new Error('Synthetic failure');
    originalApply(operation);
  };
  return originalApply;
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
    failSecondApply(board);
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

  it('rolls back a failed batch when the undo stack is full, keeping history', () => {
    const { board, editor, id } = setup();
    // Plait keeps 100 undo batches and drops the oldest when a new one is
    // added, so the stack length does not grow with the failed batch.
    for (let i = 0; i < 100; i++) {
      editor.updateMindmap([{ type: 'set_note', nodeId: id, note: `n${i}` }]);
    }
    expect(board.history.undos).toHaveLength(100);
    const undos = [...board.history.undos];
    const before = editor.serialize();
    const originalApply = failSecondApply(board);
    expect(() =>
      editor.updateMindmap([
        { type: 'set_note', nodeId: id, note: 'Must roll back' },
        { type: 'set_topic', nodeId: id, topic: 'Must roll back' },
      ])
    ).toThrow('Synthetic failure');
    board.apply = originalApply;
    expect(editor.serialize()).toBe(before);
    expect(board.history.undos).toEqual(undos);
    expect(board.history.undos[0]).toBe(undos[0]);
    board.undo();
    expect(editor.readMindmap()[0].note).toBe('n98');
  });
});

describe('inserting siblings', () => {
  function children(board: ReturnType<typeof setup>['board']) {
    return (board.children[0] as MindElement).children;
  }

  it('extends a summary that covers the node the sibling is inserted after', () => {
    const { board, editor } = setup('# Root\n## A\n## B\n## C');
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
        { type: 'insert_sibling', nodeId: String(summary?.id), topic: 'No' },
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
    const { board, editor } = setup('# Root\n## R1\n## R2\n## L1');
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

describe('nodes in collapsed branches', () => {
  /**
   * A board whose node A is collapsed. Like withMind, the board does not
   * recurse into collapsed nodes (their children are not rendered).
   */
  function collapsed() {
    const board = createTestingBoard([withHistory], []);
    const { isRecursion } = board;
    board.isRecursion = (element) =>
      MindElement.isMindElement(board, element) && element.isCollapsed
        ? false
        : isRecursion(element);
    const editor = createDrawnixEditor(board);
    editor.updateMindmap([
      { type: 'populate_empty', markdown: '# R\n## A\n### A1' },
    ]);
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { isCollapsed: true }, [0, 0]);
    });
    const [a] = editor.readMindmap()[0].children;
    return { board, editor, a, a1: a.children[0] };
  }
  const nodeA = (board: PlaitBoard) =>
    (board.children[0] as MindElement).children[0];

  it('edits a hidden node by the ID readMindmap returned', () => {
    const { editor, a1 } = collapsed();
    editor.updateMindmap([
      { type: 'set_topic', nodeId: a1.id, topic: 'renamed' },
      { type: 'set_note', nodeId: a1.id, note: 'note' },
      { type: 'insert_sibling', nodeId: a1.id, topic: 'A2' },
      { type: 'insert_child', parentId: a1.id, topic: 'A1a' },
    ]);
    const [a] = editor.readMindmap()[0].children;
    expect(a.children.map((child) => child.topic)).toEqual(['renamed', 'A2']);
    expect(a.children[0]).toMatchObject({ note: 'note' });
    expect(a.children[0].children.map((child) => child.topic)).toEqual([
      'A1a',
    ]);
  });

  it('expands a collapsed parent when inserting a child, undone together', () => {
    const { board, editor, a } = collapsed();
    editor.updateMindmap([
      { type: 'insert_child', parentId: a.id, topic: 'A2' },
    ]);
    expect(nodeA(board).isCollapsed).toBe(false);
    expect(
      editor.readMindmap()[0].children[0].children.map((child) => child.topic)
    ).toEqual(['A1', 'A2']);
    board.undo();
    expect(nodeA(board).isCollapsed).toBe(true);
    expect(nodeA(board).children).toHaveLength(1);
  });

  it('keeps the parent collapsed when the batch fails', () => {
    const { board, editor, a } = collapsed();
    const before = JSON.stringify(board.children);
    expect(() =>
      editor.updateMindmap([
        { type: 'insert_child', parentId: a.id, topic: 'A2' },
        { type: 'set_topic', nodeId: 'missing', topic: 'x' },
      ])
    ).toThrow();
    expect(JSON.stringify(board.children)).toBe(before);
  });
});

describe('editor input checks', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };
  const native = (elements: unknown) =>
    JSON.stringify({
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements,
      viewport: { zoom: 1 },
    });

  it('rejects documents whose nodes readers cannot use', () => {
    const valid = createMindmapDocument('# R\n## A').elements[0];
    expect(code(() => parseDrawnixDocument(native([valid])))).toBeUndefined();
    const child = (valid.children as unknown[])[0] as Record<string, unknown>;
    const broken: unknown[] = [
      [null],
      [{ ...valid, id: 5 }],
      [{ ...valid, data: {} }],
      [{ ...valid, data: { topic: { children: [null] } } }],
      [{ ...valid, children: [null] }],
      [{ ...valid, children: [{ ...child, data: { topic: 'text' } }] }],
      [{ ...valid, children: [{ id: 'c', type: 'mind_child' }] }],
      [{ ...valid, children: {} }],
    ];
    for (const elements of broken) {
      const parse = () => {
        const document = parseDrawnixDocument(native(elements));
        // What used to fail later, with a plain TypeError:
        createDrawnixEditor(
          createTestingBoard([], document.elements)
        ).readMindmap();
      };
      expect(code(parse)).toBe('MINDMAP_INVALID_DOCUMENT');
    }
  });

  it('rejects operations with missing or non-text fields and unknown types', () => {
    const { editor, id } = setup();
    const bad: unknown[] = [
      { type: 'set_topic', nodeId: id, topic: 5 },
      { type: 'set_topic', nodeId: id },
      { type: 'insert_child', parentId: id, topic: null },
      { type: 'insert_sibling', nodeId: 7, topic: 'x' },
      { type: 'set_note', nodeId: id, note: ['x'] },
      { type: 'delete_node', nodeId: id },
      { type: 'toString', nodeId: id, topic: 'x' },
      null,
    ];
    for (const operation of bad) {
      expect(
        code(() =>
          editor.updateMindmap([operation] as unknown as MindmapOperation[])
        )
      ).toBe('MINDMAP_INVALID_OPERATION');
    }
    expect(
      code(() =>
        editor.updateMindmap('x' as unknown as MindmapOperation[])
      )
    ).toBe('MINDMAP_INVALID_OPERATION');
    expect(
      code(() =>
        createDrawnixEditor(createTestingBoard([withHistory], [])).updateMindmap([
          { type: 'populate_empty', markdown: 5 },
        ] as unknown as MindmapOperation[])
      )
    ).toBe('MINDMAP_INVALID_OPERATION');
    // Nothing was applied.
    expect(editor.readMindmap()[0].children.map((c) => c.topic)).toEqual([
      '子节点',
    ]);
  });

  it('puts headings after a plain first line under it', () => {
    const outline = (markdown: string) => {
      const [root] = getMindmapOutline(createMindmapDocument(markdown).elements);
      const topics = (node: MindmapNode): unknown =>
        node.children.length
          ? { [node.topic]: node.children.map(topics) }
          : node.topic;
      return topics(root);
    };
    expect(outline('Root\n## A\n## B')).toEqual({ Root: ['A', 'B'] });
    expect(outline('Root\n# A\n## A1\n# B')).toEqual({
      Root: [{ A: ['A1'] }, 'B'],
    });
    expect(outline('- Root\n- A')).toEqual({ Root: ['A'] });
    expect(outline('# Root\n## A')).toEqual({ Root: ['A'] });
  });
});
