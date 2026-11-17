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
  WritableClipboardType,
} from '@plait/core';
import { copyNewNode, MindElement, MindTransforms } from '@plait/mind';
import {
  createAnkiCardId,
  getAnkiCards,
  getMindmapAnkiCards,
  parseAnkiTags,
  collectAnkiCardIds,
  deriveAnkiCardId,
  findDuplicateAnkiCardIds,
  markAnkiCardsCut,
  normalizeAnkiCardIds,
  prepareAnkiCardsForPaste,
} from './anki-cards';
import { createDrawnixEditor, parseDrawnixDocument } from './editor';
import { withAnkiCards } from './plugins/with-anki-cards';
import {
  getDocumentGeneration,
  syncDocumentSwap,
  withDocumentSwap,
} from './plugins/with-document-swap';

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

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

/** Card IDs as the read API returns them, in document order. */
const idsOf = (elements: PlaitElement[]) =>
  getMindmapAnkiCards(elements).flatMap((node) =>
    node.cards.map((item) => item.id)
  );

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
    expect(
      getAnkiCards({ id: 'n', ankiCards: 'oops' } as PlaitElement)
    ).toEqual([]);
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
  it('renews copied IDs recursively and within one paste', () => {
    const { board } = setup();
    setCards(board, [0, 0], [card('a1'), card('a2')]);
    const copy = copyNewNode(board.children[0] as MindElement);
    const pasted = prepareAnkiCardsForPaste([copy, copy], board.children);
    const ids = pasted.flatMap((root) => idsOf([root]));
    expect(ids).toHaveLength(4);
    expect(new Set([...ids, 'a1', 'a2']).size).toBe(6);
    // Content is kept; the source and clipboard data are not mutated.
    expect(getMindmapAnkiCards(pasted)[0].cards.map((c) => c.front)).toEqual([
      'Q a1',
      'Q a2',
    ]);
    expect(getAnkiCards(copy.children[0])).toEqual([card('a1'), card('a2')]);
  });

  it('renews copied IDs in another document that does not contain them', () => {
    const source = setup();
    setCards(source.board, [0, 0], [card('a1')]);
    const copy = copyNewNode(source.board.children[0] as MindElement);
    const target = setup();
    const [pasted] = prepareAnkiCardsForPaste([copy], target.board.children);
    const [id] = idsOf([pasted]);
    expect(id).not.toBe('a1');
    expect(getMindmapAnkiCards([pasted])[0].cards[0]).toEqual({
      ...card('a1'),
      id,
    });
  });

  it('keeps cut IDs only for cuts accepted as moves', () => {
    const { board } = setup();
    setCards(board, [0, 0], [card('a1')]);
    const [cut] = markAnkiCardsCut(
      [copyNewNode(board.children[0] as MindElement)],
      'cut-1'
    );
    expect(cut).toHaveProperty('ankiCardsCut', 'cut-1');
    fakeNodeWeakMap(board);
    Transforms.removeNode(board, [0]);
    const isMove = vi.fn((cutId: string) => cutId === 'cut-1');

    const [moved] = prepareAnkiCardsForPaste([cut], board.children, isMove);
    expect(idsOf([moved])).toEqual(['a1']);
    expect(moved).not.toHaveProperty('ankiCardsCut');
    expect(isMove).toHaveBeenCalledWith('cut-1');

    // Without the editor's consent (another board), the cut is a copy.
    const [copied] = prepareAnkiCardsForPaste([cut], setup().board.children);
    expect(idsOf([copied])).toHaveLength(1);
    expect(idsOf([copied])[0]).not.toBe('a1');
  });

  it('renews cut IDs that are already on the board even on the first paste', () => {
    const { board } = setup();
    setCards(board, [0, 0], [card('a1')]);
    const cut = markAnkiCardsCut(
      [copyNewNode(board.children[0] as MindElement)],
      'cut-2'
    );
    const [pasted] = prepareAnkiCardsForPaste(cut, board.children, () => true);
    expect(idsOf([pasted])[0]).not.toBe('a1');
  });

  it('keeps the IDs of every node in a moved cut', () => {
    const element = (id: string, cardId: string) =>
      ({ id, children: [], ankiCards: [card(cardId)] } as PlaitElement);
    const cut = markAnkiCardsCut(
      [element('n1', 'c1'), element('n2', 'c2')],
      'cut-3'
    );
    const pasted = prepareAnkiCardsForPaste(cut, [], () => true);
    expect(pasted.map((e) => getAnkiCards(e)[0].id)).toEqual(['c1', 'c2']);
  });

  it('only marks cut elements that contain cards', () => {
    const { board } = setup();
    const [plain] = markAnkiCardsCut([board.children[0]]);
    expect(plain).toBe(board.children[0]);
  });

  it.each([
    ['copied', false],
    ['cut', true],
  ])('keeps unknown fields and malformed entries of %s cards', (_, isCut) => {
    const malformed = { front: 'no id' };
    const element = {
      id: 'n',
      children: [],
      ankiCards: [
        { ...card('a1'), noteType: 'cloze', extra: { x: 1 } },
        malformed,
      ],
    } as PlaitElement;
    const clipboard = isCut ? markAnkiCardsCut([element]) : [element];
    const [pasted] = prepareAnkiCardsForPaste(clipboard, [], () => true);
    const [first, second] = pasted.ankiCards;
    expect(first).toEqual({
      ...card('a1'),
      noteType: 'cloze',
      extra: { x: 1 },
      id: isCut ? 'a1' : expect.not.stringMatching(/^a1$/),
    });
    expect(second).toBe(malformed);
  });

  it('marks cut fragments and prepares pasted fragments around Plait', () => {
    const { board } = setup();
    setCards(board, [0, 1], [card('b1')]);
    const child = (board.children[0] as MindElement).children[1];
    const context = {
      text: 'x',
      type: WritableClipboardType.elements,
      elements: [copyNewNode(child)],
    };
    board.buildFragment = vi.fn(() => context);
    const insertFragment = vi.fn();
    board.insertFragment = insertFragment;
    withAnkiCards(board);

    const copied = board.buildFragment(
      null,
      null,
      WritableClipboardOperationType.copy
    );
    expect(copied).toBe(context);
    const cut = board.buildFragment(
      null,
      null,
      WritableClipboardOperationType.cut
    );
    expect(cut?.elements[0]).toHaveProperty('ankiCardsCut', expect.any(String));
    expect(context.elements[0]).not.toHaveProperty('ankiCardsCut');

    board.insertFragment(
      { elements: cut?.elements, text: 'x' },
      [0, 0],
      WritableClipboardOperationType.paste
    );
    const [data, point, type] = insertFragment.mock.calls[0];
    expect(point).toEqual([0, 0]);
    expect(type).toBe(WritableClipboardOperationType.paste);
    expect(data.text).toBe('x');
    expect(data.elements[0]).not.toHaveProperty('ankiCardsCut');
    // The cut source is still on this board, so the ID is renewed.
    const [pastedCard] = getAnkiCards(data.elements[0]);
    expect(pastedCard).toMatchObject({ front: 'Q b1', back: 'A b1' });
    expect(pastedCard.id).not.toBe('b1');
  });

  it('renews a cut pasted into another board, also the first time', () => {
    const source = setup();
    setCards(source.board, [0, 1], [card('b1')]);
    const child = (source.board.children[0] as MindElement).children[1];
    source.board.buildFragment = () => ({
      text: 'x',
      type: WritableClipboardType.elements,
      elements: [copyNewNode(child)],
    });
    withAnkiCards(source.board);
    const cut = source.board.buildFragment(
      null,
      null,
      WritableClipboardOperationType.cut
    );
    fakeNodeWeakMap(source.board);
    source.board.deleteFragment([child]);

    const pasteInto = () => {
      const target = setup();
      const insertFragment = vi.fn();
      target.board.insertFragment = insertFragment;
      withAnkiCards(target.board);
      target.board.insertFragment(
        { elements: cut?.elements },
        [0, 0],
        WritableClipboardOperationType.paste
      );
      return getAnkiCards(insertFragment.mock.calls[0][0].elements[0])[0].id;
    };
    const first = pasteInto();
    const second = pasteInto();
    expect(first).not.toBe('b1');
    expect(second).not.toBe('b1');
    expect(second).not.toBe(first);
  });
});

describe('Anki card images', () => {
  // Image IDs are UUID-shaped; `name` must be hex.
  const imageId = (name: string) =>
    `00000000-0000-4000-8000-${name.padStart(12, '0')}`;
  const image = (name: string) => ({
    id: imageId(name),
    url: 'data:image/png;base64,iVBORw0KGgo=',
    mimeType: 'image/png',
    width: 10,
    height: 5,
  });

  it('reads only inline PNG, JPEG, GIF and WebP images with UUID-shaped IDs', () => {
    const { board, editor } = setup();
    const ok = image('a');
    setCards(
      board,
      [0, 0],
      [
        {
          ...card('a1'),
          frontImages: [
            ok,
            // Path-like or empty IDs could become file names in an exporter.
            { ...ok, id: '../../evil' },
            { ...ok, id: '' },
            // External and local URLs: tracking, SSRF, local files.
            { ...image('b'), url: 'https://example.com/a.png' },
            { ...image('c'), url: 'file:///etc/passwd' },
            // SVG can carry scripts; non-base64 data URLs are not produced.
            { ...image('d'), url: 'data:image/svg+xml;base64,PHN2Zz4=' },
            { ...image('e'), url: 'data:image/png,raw' },
            { ...image('f'), url: 'data:image/png;base64,<script>' },
            // A repeated ID: only the first counts.
            { ...ok, url: 'data:image/gif;base64,R0lG' },
            // The MIME type comes from the URL, not the stored field.
            {
              ...image('ab'),
              url: 'data:image/webp;base64,UklG',
              mimeType: 'text/html',
            },
          ],
        },
      ]
    );
    const [read] = editor.readAnkiCards()[0].cards;
    expect(read.frontImages).toEqual([
      ok,
      {
        ...image('ab'),
        url: 'data:image/webp;base64,UklG',
        mimeType: 'image/webp',
      },
    ]);
  });

  it('exports images of both sides and keeps old cards without them', () => {
    const { board, editor, childIds } = setup();
    setCards(
      board,
      [0, 0],
      [
        {
          ...card('a1'),
          frontImages: [image('f1')],
          backImages: [image('b1'), null],
        },
        card('a2'),
      ]
    );
    const [entry] = getMindmapAnkiCards(
      parseDrawnixDocument(editor.serialize()).elements
    );
    expect(entry.nodeId).toBe(childIds[0]);
    expect(entry.cards).toEqual([
      { ...card('a1'), frontImages: [image('f1')], backImages: [image('b1')] },
      card('a2'),
    ]);
  });

  it('copies images with a copied card, which gets a new ID', () => {
    const { board } = setup();
    setCards(board, [0, 0], [{ ...card('a1'), backImages: [image('b1')] }]);
    const [pasted] = prepareAnkiCardsForPaste(
      [copyNewNode(board.children[0] as MindElement)],
      board.children
    );
    const [copied] = getMindmapAnkiCards([pasted])[0].cards;
    expect(copied.id).not.toBe('a1');
    expect(copied.backImages).toEqual([image('b1')]);
  });
});

describe('duplicate card IDs in a document', () => {
  let template: PlaitElement[] | undefined;
  const dupDocument = (): PlaitElement[] => {
    if (!template) {
      const { board } = setup();
      // Both children and the root share IDs, as after copying in old versions.
      setCards(board, [0], [card('x'), card('x', 'Q same node')]);
      setCards(
        board,
        [0, 0],
        [card('x', 'Q child A'), { ...card('y'), extra: 1 }]
      );
      setCards(board, [0, 1], [card('y', 'Q child B'), null]);
      template = board.children;
    }
    return JSON.parse(JSON.stringify(template));
  };

  it('keeps the first ID in tree order and derives the others deterministically', () => {
    const elements = dupDocument();
    const fixes = findDuplicateAnkiCardIds(elements);
    expect(fixes.map((fix) => fix.path)).toEqual([[0], [0, 0], [0, 1]]);
    const [root] = normalizeAnkiCardIds(elements);
    const [a, b] = root.children as PlaitElement[];
    expect(root.ankiCards[0].id).toBe('x');
    expect(root.ankiCards[1].id).toBe(deriveAnkiCardId(root.id, 'x', 0));
    expect(a.ankiCards[0].id).toBe(deriveAnkiCardId(a.id, 'x', 0));
    expect(a.ankiCards[1]).toEqual({ ...card('y'), extra: 1 });
    expect(b.ankiCards[0]).toEqual({
      ...card('y', 'Q child B'),
      id: deriveAnkiCardId(b.id, 'y', 0),
    });
    expect(b.ankiCards[1]).toBeNull();
    // Same input, same result; already unique input is returned as is.
    expect(normalizeAnkiCardIds(dupDocument())).toEqual([root]);
    expect(normalizeAnkiCardIds([root])).toEqual([root]);
    expect(deriveAnkiCardId('n', 'x', 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('returns unique IDs from the read API without changing the input', () => {
    const elements = dupDocument();
    const before = JSON.stringify(elements);
    const ids = idsOf(elements);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(JSON.stringify(elements)).toBe(before);
  });

  it('repairs a loaded document once, without an undo step', async () => {
    const board = createTestingBoard([withHistory], dupDocument());
    withAnkiCards(board);
    await flush();
    const ids = [...collectAnkiCardIds(board.children, new Set())];
    expect(ids).toHaveLength(5);
    expect(board.history.undos).toHaveLength(0);
    expect(board.children).toEqual(normalizeAnkiCardIds(dupDocument()));

    // Replacing the document (host value change, import) is repaired too.
    board.children = dupDocument();
    board.afterChange();
    await flush();
    expect(board.children).toEqual(normalizeAnkiCardIds(dupDocument()));

    // Undo cannot bring a duplicate back for good: it is repaired again to
    // the same derived ID.
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { ankiCards: [card('x'), card('x')] }, [0]);
    });
    board.afterChange();
    await flush();
    // Stored IDs of the root, read raw rather than through the read API,
    // which would resolve duplicates itself.
    const rootIds = () =>
      board.children[0].ankiCards.map((c: { id: string }) => c.id);
    const derived = deriveAnkiCardId(board.children[0].id, 'x', 0);
    expect(rootIds()).toEqual(['x', derived]);
    board.undo();
    board.afterChange();
    await flush();
    expect(board.children).toEqual(normalizeAnkiCardIds(dupDocument()));
    board.redo();
    board.afterChange();
    await flush();
    expect(rootIds()).toEqual(['x', derived]);
  });
});

describe('cut, paste, undo and paste again', () => {
  /**
   * A document with one card on its second child, whose cut, delete and
   * paste go through Plait's clipboard hooks like in the app.
   */
  function documentWithCard(cardId = 'm1') {
    const { board } = setup();
    setCards(board, [0, 1], [card(cardId)]);
    board.buildFragment = () => ({
      text: 'x',
      type: WritableClipboardType.elements,
      elements: [copyNewNode((board.children[0] as MindElement).children[1])],
    });
    board.deleteFragment = () => {
      fakeNodeWeakMap(board);
      PlaitHistoryBoard.withNewBatch(board, () =>
        Transforms.removeNode(board, [0, 1])
      );
    };
    board.insertFragment = (data) => {
      fakeNodeWeakMap(board);
      PlaitHistoryBoard.withNewBatch(board, () => {
        for (const element of data?.elements ?? []) {
          Transforms.insertNode(board, element, [board.children.length]);
        }
      });
    };
    withAnkiCards(board);
    withDocumentSwap(board);
    const cut = () => {
      const fragment = board.buildFragment(
        null,
        null,
        WritableClipboardOperationType.cut
      );
      board.deleteFragment([]);
      return fragment?.elements as PlaitElement[];
    };
    const paste = (elements: PlaitElement[]) =>
      board.insertFragment(
        { elements },
        [0, 0],
        WritableClipboardOperationType.paste
      );
    const ids = () => [...collectAnkiCardIds(board.children, new Set())];
    const edit = (front: string) => {
      const cards = getAnkiCards(
        (board.children[0] as MindElement).children[1]
      );
      setCards(board, [0, 1], [{ ...cards[0], front }]);
    };
    const removeLast = () => {
      fakeNodeWeakMap(board);
      PlaitHistoryBoard.withNewBatch(board, () =>
        Transforms.removeNode(board, [board.children.length - 1])
      );
    };
    return { board, cut, paste, ids, edit, removeLast };
  }

  const shared = (a: string[], b: string[]) => a.filter((id) => b.includes(id));

  it('moves cards with their IDs when cut and pasted in the same document', () => {
    const a = documentWithCard();
    const cut = a.cut();
    expect(a.ids()).toEqual([]);
    a.paste(cut);
    expect(a.ids()).toEqual(['m1']);
    // A second paste of the same cut is a copy.
    a.paste(cut);
    expect(a.ids()).toHaveLength(2);
    expect(a.ids()[1]).not.toBe('m1');
    // Undoing the first paste and pasting again is still the same move.
    a.board.undo();
    a.board.undo();
    expect(a.ids()).toEqual([]);
    a.paste(cut);
    expect(a.ids()).toEqual(['m1']);
    a.board.undo();
    a.board.redo();
    expect(a.ids()).toEqual(['m1']);
  });

  it('renews the IDs when the cut source is back on the board', () => {
    const a = documentWithCard();
    const cut = a.cut();
    a.board.undo();
    expect(a.ids()).toEqual(['m1']);
    a.paste(cut);
    expect(a.ids()).toHaveLength(2);
    expect(a.ids()[1]).not.toBe('m1');
  });

  it('keeps the move when the pasted node is deleted and the delete undone', () => {
    const a = documentWithCard();
    a.paste(a.cut());
    a.removeLast();
    a.board.undo();
    expect(a.ids()).toEqual(['m1']);
    a.board.redo();
    a.board.undo();
    expect(a.ids()).toEqual(['m1']);
  });

  it('renews the IDs once the cut step has left the undo history', () => {
    const a = documentWithCard();
    const cut = a.cut();
    for (let i = 0; i < 100; i++) {
      setCards(a.board, [0], [card(`r${i}`)]);
    }
    a.paste(cut);
    expect(a.ids()).not.toContain('m1');
  });

  it('never lets older history steps of the source share IDs with another document', () => {
    // Edit a card, cut its node, paste it into another document, then undo
    // the cut and the edit in the source: the edit step still holds the
    // original ID and brings it back.
    const a = documentWithCard();
    a.edit('edited');
    const cut = a.cut();
    const b = documentWithCard('other');
    b.paste(cut);
    expect(b.ids()).toHaveLength(2);
    a.board.undo();
    a.board.undo();
    expect(a.ids()).toEqual(['m1']);
    expect(shared(a.ids(), b.ids())).toEqual([]);
    a.board.redo();
    a.board.redo();
    a.board.undo();
    b.board.undo();
    b.board.redo();
    expect(shared(a.ids(), b.ids())).toEqual([]);
  });

  it('gives every other document its own IDs for the same cut', () => {
    const a = documentWithCard();
    const cut = a.cut();
    const b = documentWithCard('b');
    const c = documentWithCard('c');
    b.paste(cut);
    c.paste(cut);
    expect(shared(b.ids(), c.ids())).toEqual([]);
    expect(b.ids()).not.toContain('m1');
    a.board.undo();
    expect(shared(a.ids(), [...b.ids(), ...c.ids()])).toEqual([]);
  });

  it('does not forget an old cut after many later cuts', () => {
    const a = documentWithCard();
    const cut = a.cut();
    const b = documentWithCard('b');
    b.paste(cut);
    for (let i = 0; i < 101; i++) {
      const other = documentWithCard(`x${i}`);
      other.paste(other.cut());
    }
    const c = documentWithCard('c');
    c.paste(cut);
    expect(shared(b.ids(), c.ids())).toEqual([]);
  });

  describe('when the host swaps the document on the same board', () => {
    /** What react-board's Wrapper does for a new `value`: no operation. */
    const swap = (board: PlaitBoard, elements: PlaitElement[]) => {
      board.children = elements;
    };

    it('renews the IDs of a cut from the previous document', () => {
      const a = documentWithCard();
      const cut = a.cut();
      const b = documentWithCard('b');
      swap(a.board, b.board.children);
      a.paste(cut);
      expect(a.ids()).toHaveLength(2);
      expect(a.ids()).not.toContain('m1');
    });

    it("clears the history, so undo never applies the previous document's steps", () => {
      const a = documentWithCard();
      a.edit('edited');
      const b = documentWithCard('b');
      const swapped = b.board.children;
      swap(a.board, swapped);
      a.board.undo();
      expect(a.board.children).toBe(swapped);
      expect(a.board.history).toEqual({ undos: [], redos: [] });
      a.board.redo();
      expect(a.board.children).toBe(swapped);
    });

    it('advances the document generation once per swap', () => {
      const a = documentWithCard();
      const start = getDocumentGeneration(a.board);
      a.edit('edited');
      expect(getDocumentGeneration(a.board)).toBe(start);
      swap(a.board, documentWithCard('b').board.children);
      expect(getDocumentGeneration(a.board)).toBe(start + 1);
      expect(getDocumentGeneration(a.board)).toBe(start + 1);
    });

    it('repairs duplicate IDs in the new document without waiting for an operation', async () => {
      const a = documentWithCard();
      const duplicated = documentWithCard('d');
      setCards(duplicated.board, [0, 0], [card('d')]);
      swap(a.board, duplicated.board.children);
      expect(syncDocumentSwap(a.board)).toBe(true);
      await flush();
      expect(a.ids()).toHaveLength(2);
      expect(new Set(a.ids()).size).toBe(2);
      expect(a.board.history.undos).toHaveLength(0);
    });
  });
});
