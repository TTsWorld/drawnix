// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
import { renderMindmapWidgets } from '../testing/mindmap-widget-harness';

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
}: { note?: string; cards?: MindmapAnkiCard[]; open?: boolean } = {}) {
  const document = createMindmapDocument('# Original\n## Child');
  const root = document.elements[0] as PlaitElement;
  if (note) root.note = note;
  if (cards) root.ankiCards = cards;
  return renderMindmapWidgets(
    document.elements,
    (id) => ({ openAnkiCardsId: open ? id : null }),
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

describe('mind-map Anki cards', () => {
  it('creates a card prefilled from the title and note, then keeps it independent', async () => {
    const { editor, id, board } = await setup({ note: 'Note text' });
    expect(screen.getByText('这个节点还没有卡片')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ 新增卡片' }));
    });
    const [entry] = editor.readAnkiCards();
    expect(entry).toMatchObject({
      nodeId: id,
      cards: [{ front: 'Original', back: 'Note text' }],
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
      back: 'Note text',
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
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '背面' }));
    });
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除卡片: 卡片 1' }));
    });
    expect(editor.readAnkiCards()[0].cards.map((card) => card.id)).toEqual([
      'c2',
    ]);
    expect(document.activeElement).toBe(field('卡片 1 正面'));
    expect(field('卡片 1 正面').value).toBe('Q2');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除卡片: 卡片 1' }));
    });
    expect(editor.readAnkiCards()).toEqual([]);
    expect(JSON.parse(editor.serialize()).elements[0]).not.toHaveProperty(
      'ankiCards'
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '+ 新增卡片' })
    );
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

  it('shows the card count next to the note badge and opens the panel from it', async () => {
    const { editor, id, board } = await setup({ open: false });
    expect(screen.queryByRole('complementary')).toBeNull();
    await act(async () => {
      editor.updateMindmap([{ type: 'set_note', nodeId: id, note: 'n' }]);
    });
    // Cards written by another edit (host, undo) also produce badges.
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
    const badge = screen.getByRole('button', {
      name: '打开 Anki 卡片: Original (2)',
    });
    expect(badge.textContent).toBe('2');
    const noteBadge = screen.getByRole('button', {
      name: '打开备注: Original',
    });
    expect(Number.parseFloat(badge.style.left)).toBe(
      Number.parseFloat(noteBadge.style.left) + 28
    );
    await act(async () => {
      fireEvent.click(badge);
    });
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    expect(field('卡片 1 正面').value).toBe('Q1');

    // Notes and cards share the side panel position; one replaces the other.
    await act(async () => {
      fireEvent.click(noteBadge);
    });
    expect(
      screen.queryByRole('complementary', { name: 'Anki 卡片' })
    ).toBeNull();
    expect(
      screen.getByRole('complementary', { name: '节点备注' })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(badge);
    });
    expect(
      screen.queryByRole('complementary', { name: '节点备注' })
    ).toBeNull();
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

  it('closes with Escape and when the node is deleted', async () => {
    const { board } = await setup({
      cards: [{ id: 'c1', front: 'Q', back: 'A' }],
    });
    await act(async () => {
      fireEvent.keyDown(field('卡片 1 正面'), { key: 'Escape' });
    });
    expect(screen.queryByRole('complementary')).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: '打开 Anki 卡片: Original (1)' })
      );
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
  const picker = () =>
    screen.getByRole('combobox', { name: '选择卡片' }) as HTMLSelectElement;

  it('shows one card at a time and switches with the dropdown', async () => {
    const { editor } = await twoCards();
    expect(screen.getAllByRole('textbox', { name: /正面/ })).toHaveLength(1);
    expect(
      Array.from(picker().options).map((option) => option.textContent)
    ).toEqual([
      '卡片 1 · First question',
      '卡片 2 · （正面为空）',
      '+ 新增卡片',
    ]);
    await act(async () => {
      fireEvent.change(picker(), { target: { value: 'c2' } });
    });
    expect(field('卡片 2 正面').value).toBe('');
    await act(async () => {
      fireEvent.change(picker(), { target: { value: '__new__' } });
    });
    expect(editor.readAnkiCards()[0].cards).toHaveLength(3);
    expect(picker().value).toBe(editor.readAnkiCards()[0].cards[2].id);
    expect(document.activeElement).toBe(field('卡片 3 正面'));
  });

  it('switches sides with tabs and arrow keys', async () => {
    await twoCards();
    const front = screen.getByRole('tab', { name: '正面' });
    expect(front.getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      fireEvent.keyDown(front, { key: 'ArrowRight' });
    });
    const back = screen.getByRole('tab', { name: '背面' });
    expect(back.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(back);
    expect(field('卡片 1 背面').value).toBe('A1');
    expect(screen.queryByRole('textbox', { name: '卡片 1 正面' })).toBeNull();
    // The side is kept when switching cards.
    await act(async () => {
      fireEvent.change(picker(), { target: { value: 'c2' } });
    });
    expect(field('卡片 2 背面').value).toBe('A2');
  });

  it('keeps showing a neighbour after the selected card is undone away', async () => {
    const { board } = await twoCards();
    await act(async () => {
      fireEvent.change(picker(), { target: { value: '__new__' } });
    });
    expect(picker().selectedIndex).toBe(2);
    await act(async () => {
      board.undo();
    });
    expect(picker().value).toBe('c2');
  });

  it('adds images from the upload button to the current side, compressed', async () => {
    const { editor } = await twoCards();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '背面' }));
    });
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
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '关闭大图' })
    );
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
              id: 'i1',
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
        id: 'i1',
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

    it('reports instead of claiming success when the card was deleted meanwhile', async () => {
      const { editor } = await twoCards();
      const input = screen.getByTestId('drawnix-anki-image-input');
      await settle(() =>
        fireEvent.change(input, { target: { files: [png()] } })
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: '删除卡片: 卡片 1' })
        );
      });
      // The notice about card 1 is not shown on card 2.
      expect(screen.queryByRole('status')).toBeNull();
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
