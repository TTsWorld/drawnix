// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeNodeWeakMap,
  PlaitBoard,
  PlaitHistoryBoard,
  type PlaitElement,
  Transforms,
} from '@plait/core';
import type { MindmapAnkiCard } from '../anki-cards';
import { createMindmapDocument } from '../editor';
import {
  MindmapAnkiCards,
  setAnkiImageCodecForTesting,
} from './mindmap-anki-cards';
import type { AnkiImageCodec } from '../anki-card-images';
import { MindmapNotes } from './mindmap-notes';
import {
  keepRenderPathsForShownNodesOnly,
  nodeAction,
  renderMindmapWidgets,
  selectMindNode,
} from '../testing/mindmap-widget-harness';
import { MIND_WIDGET_OPENER_CLASS_NAME } from './mindmap-widgets';
import { withDocumentSwap } from '../plugins/with-document-swap';

// jsdom has no screen coordinates; keep Plait's geometry/reference lookup real.
vi.mock('@plait/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/core')>()),
  toHostPointFromViewBoxPoint: (_board: PlaitBoard, point: number[]) => point,
  toScreenPointFromHostPoint: (_board: PlaitBoard, point: number[]) => point,
}));

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup({
  note,
  cards,
  open = true,
  openNote = false,
}: {
  note?: string;
  cards?: MindmapAnkiCard[];
  open?: boolean;
  openNote?: boolean;
} = {}) {
  const document = createMindmapDocument('# Original\n## Child');
  const root = document.elements[0] as PlaitElement;
  if (note) root.note = note;
  if (cards) root.ankiCards = cards;
  return renderMindmapWidgets(
    document.elements,
    (id) =>
      openNote ? { openNoteId: id } : { openAnkiCardsId: open ? id : null },
    <>
      <MindmapNotes />
      <MindmapAnkiCards />
    </>
  );
}

const field = (name: string) =>
  screen.getByRole('textbox', { name }) as HTMLTextAreaElement;

async function type(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.input(input, { target: { value } });
  });
}

const trigger = () => screen.getByRole('button', { name: /^选择卡片: / });
const addButton = () => screen.getByRole('button', { name: '新增卡片' });
async function openMenu() {
  await act(async () => {
    fireEvent.click(trigger());
  });
  return screen.getByRole('menu', { name: '选择卡片' });
}
async function chooseCard(name: string | RegExp) {
  await openMenu();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitemradio', { name }));
  });
}
const deleteButton = (n: number) =>
  screen.getByRole('menuitem', { name: `删除卡片 ${n}` });
/** Deletes card `n` with its row button, opening the menu if needed. */
async function deleteCard(n: number) {
  if (!screen.queryByRole('menu')) await openMenu();
  await act(async () => {
    fireEvent.click(deleteButton(n));
  });
}
async function addCard() {
  await act(async () => {
    fireEvent.click(addButton());
  });
}
async function showBack() {
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '背面' }));
  });
}

describe('mind-map Anki cards', () => {
  it('keeps note text out of existing and new cards', async () => {
    const { editor } = await setup({
      openNote: true,
      cards: [{ id: 'c1', front: 'Q', back: '' }],
    });
    await type(screen.getByRole('textbox', { name: '备注内容' }), '111');
    expect(JSON.parse(editor.serialize()).elements[0].note).toBe('111');
    // Cards are untouched by note input.
    expect(editor.readAnkiCards()[0].cards).toEqual([
      { id: 'c1', front: 'Q', back: '' },
    ]);
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开 Anki 卡片'));
    });
    expect(field('卡片 1 正面').value).toBe('Q');
    expect(screen.queryByDisplayValue('111')).toBeNull();
    await showBack();
    expect(field('卡片 1 背面').value).toBe('');

    // A new card starts with the node title on the front and nothing from the note.
    await addCard();
    const [, created] = editor.readAnkiCards()[0].cards;
    expect(created).toMatchObject({ front: 'Original', back: '' });
    expect(JSON.stringify(editor.readAnkiCards())).not.toContain('111');
    expect(screen.queryByDisplayValue('111')).toBeNull();
    expect(JSON.parse(editor.serialize()).elements[0].note).toBe('111');
  });

  it('creates a card prefilled from the title only, then keeps it independent', async () => {
    const { editor, id, board } = await setup({ note: 'Note text' });
    expect(screen.getByText('这个节点还没有卡片')).toBeTruthy();
    await addCard();
    const [entry] = editor.readAnkiCards();
    expect(entry).toMatchObject({
      nodeId: id,
      cards: [{ front: 'Original', back: '' }],
    });
    expect(entry.cards[0]).not.toHaveProperty('tags');
    expect(document.activeElement).toBe(field('卡片 1 正面'));

    await act(async () => {
      editor.updateMindmap([
        { type: 'set_topic', nodeId: id, topic: 'Renamed' },
        { type: 'set_note', nodeId: id, note: 'Changed' },
      ]);
    });
    expect(editor.readAnkiCards()[0].cards[0]).toMatchObject({
      front: 'Original',
      back: '',
    });

    await act(async () => {
      board.undo();
      board.undo();
    });
    expect(editor.readAnkiCards()).toEqual([]);
    expect(JSON.parse(editor.serialize()).elements[0]).not.toHaveProperty(
      'ankiCards'
    );
  });

  it('makes continuous typing in one field a single undo step', async () => {
    const { editor, board } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A' }],
    });
    const front = field('卡片 1 正面');
    for (const value of ['Q1', 'Q12', 'Q123']) await type(front, value);
    fireEvent.blur(front);
    await showBack();
    const back = field('卡片 1 背面');
    await type(back, 'A1');
    const stored = () => editor.readAnkiCards()[0].cards[0];
    expect(editor.readAnkiCards()[0].cards).toEqual([
      { id: 'c1', front: 'Q123', back: 'A1' },
    ]);
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', ctrlKey: true });
    });
    expect(back.value).toBe('A');
    expect(stored().front).toBe('Q123');
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', metaKey: true });
    });
    expect(stored().front).toBe('Q');
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', ctrlKey: true, shiftKey: true });
    });
    expect(stored().front).toBe('Q123');
    expect(board.history.redos).toHaveLength(1);
  });

  it('stores tags as a list while keeping the text being typed', async () => {
    const { editor } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A' }],
    });
    const tags = field('卡片 1 标签') as unknown as HTMLInputElement;
    await type(tags, 'math ');
    expect(tags.value).toBe('math ');
    await type(tags, 'math  algebra math');
    expect(editor.readAnkiCards()[0].cards[0].tags).toEqual([
      'math',
      'algebra',
    ]);
    await type(tags, ' ');
    expect(editor.readAnkiCards()[0].cards[0]).not.toHaveProperty('tags');
  });

  it('deletes one card, restores it with undo and removes the field with the last card', async () => {
    const { editor, board } = await setup({
      cards: [
        { id: 'c1', front: 'Q1', back: 'A1' },
        { id: 'c2', front: 'Q2', back: 'A2' },
      ],
    });
    await deleteCard(1);
    expect(editor.readAnkiCards()[0].cards.map((card) => card.id)).toEqual([
      'c2',
    ]);
    // The menu stays open on the remaining card, which is now shown.
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('卡片 1 · Q2');
    expect(field('卡片 1 正面').value).toBe('Q2');
    expect(screen.getByRole('status').textContent).toBe(
      '已删除卡片 1，按 Ctrl/⌘+Z 可撤销'
    );
    await deleteCard(1);
    expect(editor.readAnkiCards()).toEqual([]);
    expect(JSON.parse(editor.serialize()).elements[0]).not.toHaveProperty(
      'ankiCards'
    );
    // No card left: the menu goes away with the picker; the empty state shows.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('这个节点还没有卡片')).toBeTruthy();
    expect(document.activeElement).toBe(addButton());
    expect(screen.getByRole('status').textContent).toMatch(/^已删除卡片 1/);
    await act(async () => {
      board.undo();
      board.undo();
    });
    expect(editor.readAnkiCards()[0].cards.map((card) => card.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('keeps unknown card fields when editing', async () => {
    const { editor } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A', extra: 1 } as MindmapAnkiCard],
    });
    await type(field('卡片 1 正面'), 'Q2');
    const stored = JSON.parse(editor.serialize()).elements[0].ankiCards;
    expect(stored).toEqual([{ id: 'c1', front: 'Q2', back: 'A', extra: 1 }]);
  });

  it('fills the card button when the node has cards and switches panels from the node buttons', async () => {
    const { editor, id, board } = await setup({ open: false });
    expect(screen.queryByRole('complementary')).toBeNull();
    await act(async () => {
      editor.updateMindmap([{ type: 'set_note', nodeId: id, note: 'n' }]);
    });
    // Cards written by another edit (host, undo) also update the button.
    await act(async () => {
      PlaitHistoryBoard.withNewBatch(board, () => {
        Transforms.setNode(
          board,
          {
            ankiCards: [
              { id: 'c1', front: 'Q1', back: 'A1' },
              { id: 'c2', front: 'Q2', back: 'A2' },
            ],
          },
          [0]
        );
      });
    });
    await selectMindNode(board, id);
    const cards = nodeAction('Original', '打开 Anki 卡片');
    // No count anywhere on the node: the fill says there are cards.
    expect(cards.textContent).toBe('');
    expect(cards.title).toBe('打开 Anki 卡片');
    expect(cards.classList).toContain('drawnix-node-action--filled');
    const note = nodeAction('Original', '打开备注');
    await act(async () => {
      fireEvent.click(cards);
    });
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    expect(field('卡片 1 正面').value).toBe('Q1');

    // Notes and cards share the side panel position; one replaces the other.
    await act(async () => {
      fireEvent.click(note);
    });
    expect(
      screen.queryByRole('complementary', { name: 'Anki 卡片' })
    ).toBeNull();
    expect(
      screen.getByRole('complementary', { name: '节点备注' })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开 Anki 卡片'));
    });
    expect(
      screen.queryByRole('complementary', { name: '节点备注' })
    ).toBeNull();
    // A second press on the open panel's button closes it.
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开 Anki 卡片'));
    });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it.each(['copy', 'cut', 'paste', 'keydown'])(
    'keeps %s inside the panel without cancelling native text editing',
    async (type) => {
      const { editor } = await setup({
        cards: [{ id: 'c1', front: 'Q', back: 'A' }],
      });
      const before = editor.serialize();
      const boardListener = vi.fn((event: Event) => event.preventDefault());
      window.addEventListener(type, boardListener);
      try {
        const event =
          type === 'keydown'
            ? new KeyboardEvent(type, {
                key: 'Delete',
                bubbles: true,
                cancelable: true,
              })
            : new Event(type, { bubbles: true, cancelable: true });
        fireEvent(field('卡片 1 正面'), event);
        expect(boardListener).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(editor.serialize()).toBe(before);
      } finally {
        window.removeEventListener(type, boardListener);
      }
    }
  );

  describe('closing on a press outside the panel', () => {
    const panel = () => screen.queryByRole('complementary');
    const pressOn = (target: Element) =>
      act(async () => {
        fireEvent.pointerDown(target);
      });

    it('closes on the board or another node, keeping the typed text and its undo step', async () => {
      const { editor, board } = await setup({
        cards: [{ id: 'c1', front: 'Q', back: 'A' }],
      });
      const front = field('卡片 1 正面');
      front.focus();
      await type(front, 'Q1');
      await type(front, 'Q12');
      const undos = board.history.undos.length;
      // Stands in for the board canvas and other nodes.
      const canvas = document.createElement('div');
      document.body.append(canvas);
      try {
        await pressOn(canvas);
      } finally {
        canvas.remove();
      }
      expect(panel()).toBeNull();
      // Focus left the field first, so an IME composition would be committed.
      expect(document.activeElement).not.toBe(front);
      expect(editor.readAnkiCards()[0].cards[0].front).toBe('Q12');
      expect(board.history.undos).toHaveLength(undos);
      await act(async () => {
        board.undo();
      });
      expect(editor.readAnkiCards()[0].cards[0].front).toBe('Q');
    });

    it('stays open for presses on its tabs, menu, image controls and preview', async () => {
      setAnkiImageCodecForTesting(fakeCodec);
      try {
        await setup({ cards: [{ id: 'c1', front: 'Q', back: 'A' }] });
        await pressOn(screen.getByRole('tab', { name: '背面' }));
        await pressOn(trigger());
        await openMenu();
        await pressOn(screen.getByRole('menuitemradio', { name: /^卡片 1/ }));
        await pressOn(field('卡片 1 正面'));
        await pressOn(addButton());
        await pressOn(screen.getByRole('button', { name: '添加图片' }));
        const input = screen.getByTestId('drawnix-anki-image-input');
        await settle(() =>
          fireEvent.change(input, { target: { files: [png()] } })
        );
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: '查看大图: 图片 1' })
          );
        });
        await pressOn(screen.getByRole('dialog', { name: '图片 1' }));
        expect(panel()).toBeTruthy();
      } finally {
        setAnkiImageCodecForTesting();
      }
    });

    it('switches instead of closing when the press opens another widget', async () => {
      await setup({
        note: 'n',
        cards: [{ id: 'c1', front: 'Q', back: 'A' }],
      });
      const noteButton = nodeAction('Original', '打开备注');
      await pressOn(noteButton);
      expect(
        screen.getByRole('complementary', { name: 'Anki 卡片' })
      ).toBeTruthy();
      await act(async () => {
        fireEvent.click(noteButton);
      });
      expect(
        screen.getByRole('complementary', { name: '节点备注' })
      ).toBeTruthy();
      // The note panel closes on outside presses too.
      await pressOn(document.body);
      expect(panel()).toBeNull();
    });

    it("closes for another embedded editor's opener", async () => {
      await setup({ cards: [{ id: 'c1', front: 'Q', back: 'A' }] });
      const other = document.createElement('div');
      other.className = 'drawnix';
      const opener = document.createElement('button');
      opener.className = MIND_WIDGET_OPENER_CLASS_NAME;
      other.append(opener);
      document.body.append(other);
      try {
        await pressOn(opener);
      } finally {
        other.remove();
      }
      expect(panel()).toBeNull();
    });
  });

  it('stays open for a node whose ancestor is collapsed', async () => {
    const document = createMindmapDocument('# Original\n## Child');
    const root = document.elements[0] as PlaitElement;
    root.isCollapsed = true;
    const child = root.children[0];
    child.ankiCards = [{ id: 'c1', front: 'Q', back: 'A' }];
    const { board, appState } = await renderMindmapWidgets(
      document.elements,
      () => ({ openAnkiCardsId: child.id }),
      <MindmapAnkiCards />
    );
    // Like withMind: collapsed nodes are not recursed into for rendering.
    board.isRecursion = (element) => !element.isCollapsed;
    await act(async () => board.afterChange());
    expect(appState.current?.openAnkiCardsId).toBe(child.id);
    expect(field('卡片 1 正面').value).toBe('Q');
  });

  it('keeps saving cards of a node inside a collapsed branch', async () => {
    const document = createMindmapDocument('# Original\n## Child');
    const root = document.elements[0] as PlaitElement;
    root.isCollapsed = true;
    const child = root.children[0];
    child.ankiCards = [{ id: 'c1', front: 'Q', back: 'A' }];
    const { board, editor } = await renderMindmapWidgets(
      document.elements,
      () => ({ openAnkiCardsId: child.id }),
      <MindmapAnkiCards />
    );
    board.isRecursion = (element) => !element.isCollapsed;
    // Each edit creates a new node object that is never rendered.
    keepRenderPathsForShownNodesOnly(board);
    await type(field('卡片 1 正面'), 'Q1');
    await type(field('卡片 1 正面'), 'Q12');
    await addCard();
    await type(field('卡片 2 正面'), 'second');
    const cards = editor
      .readAnkiCards()
      .find((node) => node.nodeId === child.id);
    expect(cards?.cards.map((card) => card.front)).toEqual(['Q12', 'second']);
  });

  it('closes with Escape and when the node is deleted', async () => {
    const { board, id } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A' }],
    });
    await act(async () => {
      fireEvent.keyDown(field('卡片 1 正面'), { key: 'Escape' });
    });
    expect(screen.queryByRole('complementary')).toBeNull();
    await selectMindNode(board, id);
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开 Anki 卡片'));
    });
    expect(screen.getByRole('complementary')).toBeTruthy();
    await act(async () => {
      Transforms.removeNode(board, [0]);
    });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /Anki/ })).toBeNull();
  });

  it('ignores late input when the edited node has been removed', async () => {
    const { board, editor } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A' }],
    });
    const input = field('卡片 1 正面');
    await act(async () => {
      Transforms.insertNode(
        board,
        createMindmapDocument('# Other node').elements[0],
        [1]
      );
    });
    await act(async () => {
      Transforms.removeNode(board, [0]);
      await Promise.resolve();
      // Set the DOM value the way the browser does, bypassing React's tracker.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set?.call(input, 'Late user edit');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(editor.readAnkiCards()).toEqual([]);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

let encodedUrl = (type: string) => `data:${type};base64,AAAA`;
const fakeCodec: AnkiImageCodec = {
  decode: async () => ({ width: 2000, height: 1000, source: {} as never }),
  encode: async (_image, _w, _h, type) => new Blob(['x'], { type }),
  toDataUrl: async (blob) => encodedUrl(blob.type),
};
const png = (name = 'a.png') =>
  new File([new Uint8Array(10)], name, { type: 'image/png' });
const transfer = (files: File[], text = '') => ({
  files,
  items: [],
  types: files.length ? ['Files'] : ['text/plain'],
  getData: (type: string) => (type === 'text/plain' ? text : ''),
});
async function settle(run: () => void) {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Anki card panel layout and images', () => {
  beforeEach(() => {
    encodedUrl = (type) => `data:${type};base64,AAAA`;
    setAnkiImageCodecForTesting(fakeCodec);
  });
  afterEach(() => setAnkiImageCodecForTesting());

  const twoCards = () =>
    setup({
      cards: [
        { id: 'c1', front: 'First question\nmore', back: 'A1' },
        { id: 'c2', front: '', back: 'A2' },
      ],
    });
  const currentLabel = () =>
    trigger().getAttribute('aria-label')?.replace('选择卡片: ', '');

  it('shows one card at a time and switches with the dropdown', async () => {
    const { editor } = await twoCards();
    expect(screen.getAllByRole('textbox', { name: /正面/ })).toHaveLength(1);
    // The dropdown is the panel title; there is no separate title text.
    expect(screen.queryByText('Anki 卡片')).toBeNull();
    expect(trigger().textContent).toBe('卡片 1 · First question1/2');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await openMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(
      screen
        .getAllByRole('menuitemradio')
        .map((item) => [item.textContent, item.getAttribute('aria-checked')])
    ).toEqual([
      ['卡片 1 · First question', 'true'],
      ['卡片 2 · （正面为空）', 'false'],
    ]);
    // Adding is a separate button; deleting is the item at the end of each
    // row (a menu may only hold menu items).
    expect(
      screen
        .queryAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label'))
    ).toEqual(['删除卡片 1', '删除卡片 2']);
    expect(screen.queryByText('删除当前卡片')).toBeNull();
    const rows = Array.from(
      document.querySelectorAll('.drawnix-anki-menu-row')
    );
    expect(
      rows.map((row) =>
        Array.from(row.children).map(
          (child) => child.getAttribute('role') ?? child.getAttribute('title')
        )
      )
    ).toEqual([
      // Only menu items in a menu: the delete button is one too.
      ['menuitemradio', 'menuitem'],
      ['menuitemradio', 'menuitem'],
    ]);
    expect(deleteButton(2).getAttribute('aria-label')).toBe('删除卡片 2');
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^卡片 2/ }));
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(field('卡片 2 正面').value).toBe('');
    expect(currentLabel()).toBe('卡片 2 · （正面为空）');
    await addCard();
    expect(editor.readAnkiCards()[0].cards).toHaveLength(3);
    expect(currentLabel()).toBe('卡片 3 · Original');
    expect(document.activeElement).toBe(field('卡片 3 正面'));
  });

  it('works the dropdown with the keyboard; Escape closes only the menu', async () => {
    const { editor, board } = await twoCards();
    const key = (target: Element, name: string) =>
      act(async () => {
        fireEvent.keyDown(target, { key: name });
      });
    await key(trigger(), 'ArrowDown');
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('卡片 1 · First question');
    await key(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('卡片 2 · （正面为空）');
    await key(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('卡片 1 · First question');
    await key(menu, 'End');
    expect(document.activeElement?.textContent).toBe('卡片 2 · （正面为空）');
    await key(menu, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('卡片 1 · First question');
    await key(menu, 'Home');
    await key(menu, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('卡片 2 · （正面为空）');

    await key(menu, 'Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    expect(document.activeElement).toBe(trigger());
    expect(currentLabel()).toBe('卡片 1 · First question');

    // Enter on a focused item activates it, like a click.
    await key(trigger(), 'ArrowDown');
    await key(screen.getByRole('menu'), 'ArrowDown');
    await act(async () => {
      fireEvent.click(document.activeElement as HTMLElement);
    });
    expect(currentLabel()).toBe('卡片 2 · （正面为空）');
    expect(document.activeElement).toBe(trigger());

    // ArrowUp opens on the last card; Delete on a row deletes that card as
    // one undo step and keeps the menu open on its neighbour.
    await key(trigger(), 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('卡片 2 · （正面为空）');
    await key(document.activeElement as Element, 'Delete');
    expect(editor.readAnkiCards()[0].cards.map((card) => card.id)).toEqual([
      'c1',
    ]);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('卡片 1 · First question');
    expect(currentLabel()).toBe('卡片 1 · First question');
    await key(screen.getByRole('menu'), 'Escape');
    await act(async () => {
      board.undo();
    });
    expect(editor.readAnkiCards()[0].cards.map((card) => card.id)).toEqual([
      'c1',
      'c2',
    ]);

    // Escape without an open menu still closes the panel.
    await key(trigger(), 'Escape');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  describe('deleting from a menu row', () => {
    const threeCards = () =>
      setup({
        cards: [
          { id: 'c1', front: 'Q1', back: 'A1' },
          { id: 'c2', front: 'Q2', back: 'A2' },
          { id: 'c3', front: 'Q3', back: 'A3' },
        ],
      });
    const ids = (editor: Awaited<ReturnType<typeof setup>>['editor']) =>
      editor.readAnkiCards()[0].cards.map((card) => card.id);
    const checked = () =>
      screen
        .getAllByRole('menuitemradio')
        .filter((item) => item.getAttribute('aria-checked') === 'true')
        .map((item) => item.textContent);

    it('deletes another card without switching to it or closing anything', async () => {
      const { editor } = await threeCards();
      await chooseCard(/^卡片 2/);
      await openMenu();
      // A real press: pointerdown, mousedown, click.
      const button = deleteButton(1);
      await act(async () => {
        fireEvent.pointerDown(button);
        const mouseDown = fireEvent.mouseDown(button);
        // The press keeps focus on the rows.
        expect(mouseDown).toBe(false);
        fireEvent.click(button);
      });
      expect(ids(editor)).toEqual(['c2', 'c3']);
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(screen.getByRole('complementary')).toBeTruthy();
      // Still card c2, now in first place.
      expect(checked()).toEqual(['卡片 1 · Q2']);
      expect(field('卡片 1 正面').value).toBe('Q2');
      expect(screen.getByRole('status').textContent).toBe(
        '已删除卡片 1，按 Ctrl/⌘+Z 可撤销'
      );
      await deleteCard(2);
      expect(ids(editor)).toEqual(['c2']);
      expect(checked()).toEqual(['卡片 1 · Q2']);
      expect(screen.getByRole('status').textContent).toMatch(/^已删除卡片 2/);
    });

    it('shows the next card, or the previous one at the end, after deleting the shown card', async () => {
      const { editor } = await threeCards();
      await chooseCard(/^卡片 2/);
      await deleteCard(2);
      expect(ids(editor)).toEqual(['c1', 'c3']);
      expect(field('卡片 2 正面').value).toBe('Q3');
      expect(checked()).toEqual(['卡片 2 · Q3']);
      await deleteCard(2);
      expect(ids(editor)).toEqual(['c1']);
      expect(field('卡片 1 正面').value).toBe('Q1');
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('restores the card with Ctrl/⌘+Z while the menu is open', async () => {
      const { editor } = await threeCards();
      await chooseCard(/^卡片 3/);
      await deleteCard(1);
      expect(ids(editor)).toEqual(['c2', 'c3']);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole('menu'), {
          key: 'z',
          ctrlKey: true,
        });
      });
      expect(ids(editor)).toEqual(['c1', 'c2', 'c3']);
      // The shown card is kept by ID, back in its old place.
      expect(currentLabel()).toBe('卡片 3 · Q3');
    });

    it('deletes the focused row with Backspace, never the mind-map node', async () => {
      const { editor, board } = await threeCards();
      const nodes = board.children.length;
      await act(async () => {
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
      });
      await act(async () => {
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
      });
      expect(document.activeElement?.textContent).toBe('卡片 2 · Q2');
      const backspace = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        document.activeElement?.dispatchEvent(backspace);
      });
      expect(backspace.defaultPrevented).toBe(true);
      expect(ids(editor)).toEqual(['c1', 'c3']);
      expect(board.children).toHaveLength(nodes);
      // Focus moves to the card that took the deleted row's place.
      expect(document.activeElement?.textContent).toBe('卡片 2 · Q3');
      expect(currentLabel()).toBe('卡片 1 · Q1');
    });

    it('deletes one card per key press, ignoring auto-repeat while held', async () => {
      const { editor } = await threeCards();
      await act(async () => {
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
      });
      const press = (repeat: boolean) =>
        act(async () => {
          fireEvent.keyDown(document.activeElement as Element, {
            key: 'Delete',
            repeat,
          });
        });
      await press(false);
      await press(true);
      await press(true);
      expect(ids(editor)).toEqual(['c2', 'c3']);
      expect(document.activeElement?.textContent).toBe('卡片 1 · Q2');
      await press(false);
      expect(ids(editor)).toEqual(['c3']);
    });

    it('keeps the delete buttons out of the Tab order but labelled', async () => {
      await threeCards();
      await openMenu();
      for (const n of [1, 2, 3]) {
        expect(deleteButton(n).getAttribute('tabindex')).toBe('-1');
        expect(deleteButton(n).getAttribute('title')).toBe(`删除卡片 ${n}`);
      }
      expect(
        screen
          .getAllByRole('menuitemradio')[0]
          .getAttribute('aria-keyshortcuts')
      ).toBe('Delete Backspace');
    });
  });

  it('closes the menu, not the panel, on a press elsewhere in the panel', async () => {
    await twoCards();
    await openMenu();
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('tab', { name: '背面' }));
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('complementary')).toBeTruthy();
  });

  it('moves Tab focus from the menu to the next control, and Shift+Tab to the picker', async () => {
    await twoCards();
    await openMenu();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      screen.getByRole('menu').dispatchEvent(tab);
    });
    // Default Tab would start from the removed menu item.
    expect(tab.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(addButton());
    await openMenu();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('menu'), {
        key: 'Tab',
        shiftKey: true,
      });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('switches sides with tabs and arrow keys', async () => {
    await twoCards();
    const front = screen.getByRole('tab', { name: '正面' });
    expect(front.getAttribute('aria-selected')).toBe('true');
    // aria-controls only points at a panel that exists.
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.getAttribute('aria-controls');
      if (controls) expect(document.getElementById(controls)).not.toBeNull();
    }
    expect(front.getAttribute('aria-controls')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(front, { key: 'ArrowRight' });
    });
    const back = screen.getByRole('tab', { name: '背面' });
    expect(back.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(back);
    expect(field('卡片 1 背面').value).toBe('A1');
    expect(screen.queryByRole('textbox', { name: '卡片 1 正面' })).toBeNull();
    // The side is kept when switching cards.
    await chooseCard(/^卡片 2/);
    expect(field('卡片 2 背面').value).toBe('A2');
  });

  it('focuses fields and tabs of cards whose IDs need CSS escaping', async () => {
    // IDs come from documents; quotes or backslashes must not break selectors.
    for (const id of ['a"b', 'a\\b', 'a\nb]']) {
      cleanup();
      await setup({ cards: [{ id, front: 'Q', back: 'A' }] });
      const front = screen.getByRole('tab', { name: '正面' });
      await act(async () => {
        fireEvent.keyDown(front, { key: 'ArrowRight' });
      });
      expect(document.activeElement).toBe(
        screen.getByRole('tab', { name: '背面' })
      );
      await addCard();
      expect(document.activeElement).toBe(field('卡片 2 正面'));
    }
  });

  it('keeps showing a neighbour after the selected card is undone away', async () => {
    const { board } = await twoCards();
    await addCard();
    expect(currentLabel()).toMatch(/^卡片 3 /);
    await act(async () => {
      board.undo();
    });
    expect(currentLabel()).toBe('卡片 2 · （正面为空）');
  });

  it('adds images from the upload button to the current side, compressed', async () => {
    const { editor } = await twoCards();
    await showBack();
    const input = screen.getByTestId('drawnix-anki-image-input');
    await settle(() =>
      fireEvent.change(input, { target: { files: [png(), png('b.png')] } })
    );
    const [card] = editor.readAnkiCards()[0].cards;
    expect(card.frontImages).toBeUndefined();
    expect(card.backImages).toEqual([
      expect.objectContaining({
        url: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        width: 1280,
        height: 640,
      }),
      expect.objectContaining({ mimeType: 'image/png' }),
    ]);
    expect(card.backImages?.[0].id).not.toBe(card.backImages?.[1].id);
    expect(screen.getAllByRole('img', { name: /图片/ })).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('已添加图片');
  });

  it('recovers when a batch fails unexpectedly, and keeps processing later ones', async () => {
    const { editor, board } = await twoCards();
    const input = screen.getByTestId('drawnix-anki-image-input');
    const theme = board.theme;
    // Reading the document size fails once (outside the per-file checks).
    board.theme = {
      ...theme,
      toJSON: () => {
        throw new Error('Synthetic failure');
      },
    } as typeof theme;
    await settle(() => fireEvent.change(input, { target: { files: [png()] } }));
    board.theme = theme;
    const add = screen.getByRole('button', { name: '添加图片' });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('无法读取这张图片');
    await settle(() => fireEvent.change(input, { target: { files: [png()] } }));
    expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('已添加图片');
  });

  it('takes pasted and dropped image files without reaching the board', async () => {
    const { editor } = await twoCards();
    const boardListener = vi.fn();
    window.addEventListener('paste', boardListener);
    window.addEventListener('drop', boardListener);
    try {
      const pasted = new Event('paste', { bubbles: true, cancelable: true });
      Object.assign(pasted, { clipboardData: transfer([png()]) });
      await settle(() => fireEvent(field('卡片 1 正面'), pasted));
      expect(pasted.defaultPrevented).toBe(true);
      const dropped = new Event('drop', { bubbles: true, cancelable: true });
      Object.assign(dropped, { dataTransfer: transfer([png()]) });
      await settle(() =>
        fireEvent(screen.getByRole('tab', { name: '正面' }), dropped)
      );
      expect(dropped.defaultPrevented).toBe(true);
      expect(boardListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('paste', boardListener);
      window.removeEventListener('drop', boardListener);
    }
    expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(2);
  });

  it('leaves text pastes to the textarea even when the clipboard has an image', async () => {
    const { editor } = await twoCards();
    const pasted = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(pasted, { clipboardData: transfer([png()], 'copied text') });
    await settle(() => fireEvent(field('卡片 1 正面'), pasted));
    expect(pasted.defaultPrevented).toBe(false);
    expect(editor.readAnkiCards()[0].cards[0].frontImages).toBeUndefined();
  });

  it('explains why an image pasted without a card is not added', async () => {
    // The panel is open on a node that has no cards yet.
    await setup({ cards: [] });
    const pasted = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(pasted, { clipboardData: transfer([png()]) });
    await act(async () => {
      fireEvent(
        screen.getByRole('complementary', { name: 'Anki 卡片' }),
        pasted
      );
    });
    expect(pasted.defaultPrevented).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(
      '请先添加卡片，图片属于卡片'
    );
  });

  it('leaves Mod+Alt+Z to the browser and undoes with Mod+Z only', async () => {
    await twoCards();
    const before = field('卡片 1 正面').value;
    await type(field('卡片 1 正面'), 'typed');
    const key = (init: KeyboardEventInit) =>
      act(async () => {
        fireEvent.keyDown(field('卡片 1 正面'), { key: 'z', ...init });
      });
    await key({ metaKey: true, altKey: true });
    expect(field('卡片 1 正面').value).toBe('typed');
    await key({ metaKey: true });
    expect(field('卡片 1 正面').value).toBe(before);
  });

  it('reports unsupported files and a full document instead of failing silently', async () => {
    const { editor } = await twoCards();
    const before = editor.serialize();
    const input = screen.getByTestId('drawnix-anki-image-input');
    await settle(() =>
      fireEvent.change(input, {
        target: {
          files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
        },
      })
    );
    expect(screen.getByRole('alert').textContent).toMatch(/不支持的图片格式/);
    encodedUrl = (type) => `data:${type};base64,${'A'.repeat(8 * 1024 * 1024)}`;
    await settle(() => fireEvent.change(input, { target: { files: [png()] } }));
    expect(screen.getByRole('alert').textContent).toMatch(
      /图片未添加：文档会超过 8 MiB 上限（添加后约 8\.\d MiB）/
    );
    expect(editor.serialize()).toBe(before);
  });

  it('previews and removes images; undo restores them; Escape closes only the preview', async () => {
    const { editor, board } = await twoCards();
    const input = screen.getByTestId('drawnix-anki-image-input');
    await settle(() => fireEvent.change(input, { target: { files: [png()] } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '查看大图: 图片 1' }));
    });
    const dialog = screen.getByRole('dialog', { name: '图片 1' });
    const closePreview = screen.getByRole('button', { name: '关闭大图' });
    expect(document.activeElement).toBe(closePreview);
    // Modal: it covers the panel, so Tab stays inside it.
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        closePreview.dispatchEvent(tab);
      });
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(closePreview);
    }
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除图片: 图片 1' }));
    });
    expect(editor.readAnkiCards()[0].cards[0]).not.toHaveProperty(
      'frontImages'
    );
    await act(async () => {
      board.undo();
    });
    expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(1);
  });

  it('loads images from saved documents and shows image counts on tabs', async () => {
    const { editor } = await setup({
      cards: [
        {
          id: 'c1',
          front: 'Q',
          back: 'A',
          backImages: [
            {
              id: '00000000-0000-4000-8000-0000000000a1',
              url: 'data:image/jpeg;base64,AA',
              mimeType: '',
              width: 3,
              height: 2,
            },
          ],
        },
      ],
    });
    expect(screen.getByRole('tab', { name: '背面' }).textContent).toBe('背面1');
    expect(editor.readAnkiCards()[0].cards[0].backImages).toEqual([
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        url: 'data:image/jpeg;base64,AA',
        mimeType: 'image/jpeg',
        width: 3,
        height: 2,
      },
    ]);
  });

  describe('while images are processing', () => {
    let release: () => void = () => undefined;
    beforeEach(() => {
      let gate = Promise.resolve();
      const hold = () => {
        gate = new Promise((resolve) => (release = resolve));
      };
      hold();
      setAnkiImageCodecForTesting({
        ...fakeCodec,
        decode: async (file) => {
          await gate;
          return fakeCodec.decode(file);
        },
      });
    });

    it('queues a second paste instead of dropping it', async () => {
      const { editor } = await twoCards();
      const paste = () => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.assign(event, { clipboardData: transfer([png()]) });
        fireEvent(field('卡片 1 正面'), event);
      };
      await settle(paste);
      await settle(paste);
      expect(screen.getByRole('status').textContent).toBe('正在处理图片…');
      await settle(() => release());
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(2);
      expect(screen.getByRole('status').textContent).toBe('已添加图片');
    });

    it('drops the images when the host swaps in a document with the same card', async () => {
      const { editor, board } = await twoCards();
      withDocumentSwap(board);
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      // Another copy of the same document (same node and card IDs), passed
      // in as a new `value`: react-board replaces the children directly.
      board.children = JSON.parse(JSON.stringify(board.children));
      fakeNodeWeakMap(board);
      const swapped = board.children;
      await settle(() => release());
      expect(board.children).toBe(swapped);
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toBeUndefined();
      expect(board.history.undos).toHaveLength(0);
      expect(screen.getByRole('alert').textContent).toBe(
        '图片未添加：文档已切换'
      );
    });

    it('still commits images the user added when the panel closes', async () => {
      const { editor, board, appState } = await twoCards();
      const undos = board.history.undos.length;
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png(), png()] } })
      );
      await act(async () => {
        fireEvent.keyDown(field('卡片 1 正面'), { key: 'Escape' });
      });
      expect(appState.current?.openAnkiCardsId).toBeNull();
      await settle(() => release());
      // An image the user already gave the panel lands on its card even
      // though the panel is closed; it is one undo step.
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(2);
      expect(board.history.undos).toHaveLength(undos + 1);
    });

    it('lets the host wait for pending images before closing', async () => {
      const { editor } = await twoCards();
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      let result: string | undefined;
      const wait = editor.waitForPendingCardImages().then((value) => {
        result = value;
      });
      // The batch is held by the codec: the wait must not resolve yet.
      await settle(() => undefined);
      expect(result).toBeUndefined();
      await settle(() => release());
      await wait;
      expect(result).toBe('idle');
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(1);
    });

    it('bounds the host wait when a batch never settles and reports timeout', async () => {
      const { editor } = await twoCards();
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      // Not released: the wait must still return within its bound as timeout.
      await expect(editor.waitForPendingCardImages(20)).resolves.toBe(
        'timeout'
      );
    });

    it('keeps committed images in serialize after the panel unmounts', async () => {
      const { editor, appState } = await twoCards();
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      // Close the panel (unmount MindmapAnkiCards). onValueChange may already
      // be detached in a host teardown; serialize must still see the commit.
      await act(async () => {
        fireEvent.keyDown(field('卡片 1 正面'), { key: 'Escape' });
      });
      expect(appState.current?.openAnkiCardsId).toBeNull();
      const waiting = editor.waitForPendingCardImages();
      await settle(() => release());
      await expect(waiting).resolves.toBe('idle');
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toHaveLength(1);
      // serialize() reads board.children directly — works even if onValueChange
      // was detached during host teardown.
      expect(editor.serialize()).toContain('data:image/png;base64,AAAA');
    });

    it('stops decoding remaining files once the document generation changes', async () => {
      const { editor, board } = await twoCards();
      withDocumentSwap(board);
      let decodeCount = 0;
      setAnkiImageCodecForTesting({
        ...fakeCodec,
        decode: async (file) => {
          decodeCount += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return fakeCodec.decode(file);
        },
      });
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png(), png()] } })
      );
      expect(decodeCount).toBe(1);
      board.children = JSON.parse(JSON.stringify(board.children));
      fakeNodeWeakMap(board);
      await settle(() => release());
      // Second file must not be decoded after the swap.
      expect(decodeCount).toBe(1);
      expect(editor.readAnkiCards()[0].cards[0].frontImages).toBeUndefined();
    });

    it('keeps adding images on other cards while one card is processing', async () => {
      await twoCards();
      const add = () =>
        screen.getByRole('button', { name: '添加图片' }) as HTMLButtonElement;
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      expect(add().disabled).toBe(true);
      await chooseCard(/^卡片 2/);
      expect(add().disabled).toBe(false);
      await chooseCard(/^卡片 1/);
      expect(add().disabled).toBe(true);
      await settle(() => release());
      expect(add().disabled).toBe(false);
    });

    it('reports instead of claiming success when the card was deleted meanwhile', async () => {
      const { editor } = await twoCards();
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      await deleteCard(1);
      // The progress notice about card 1 is not shown on card 2.
      expect(screen.getByRole('status').textContent).toMatch(/^已删除卡片 1/);
      await settle(() => release());
      expect(editor.readAnkiCards()[0].cards).toEqual([
        { id: 'c2', front: '', back: 'A2' },
      ]);
      expect(screen.queryByText('已添加图片')).toBeNull();
      expect(screen.getByRole('alert').textContent).toBe(
        '图片未添加：目标卡片已被删除'
      );
    });
  });
});
