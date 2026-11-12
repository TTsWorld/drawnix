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
import { MindmapAnkiCards } from './mindmap-anki-cards';
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
    const back = field('卡片 1 背面');
    await type(back, 'A1');
    expect(editor.readAnkiCards()[0].cards).toEqual([
      { id: 'c1', front: 'Q123', back: 'A1' },
    ]);
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', ctrlKey: true });
    });
    expect(back.value).toBe('A');
    expect(front.value).toBe('Q123');
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', metaKey: true });
    });
    expect(front.value).toBe('Q');
    await act(async () => {
      fireEvent.keyDown(back, { key: 'z', ctrlKey: true, shiftKey: true });
    });
    expect(front.value).toBe('Q123');
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
      cards: [
        { id: 'c1', front: 'Q', back: 'A', extra: 1 } as MindmapAnkiCard,
      ],
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
    const noteBadge = screen.getByRole('button', { name: '打开备注: Original' });
    expect(Number.parseFloat(badge.style.left)).toBe(
      Number.parseFloat(noteBadge.style.left) + 28
    );
    await act(async () => {
      fireEvent.click(badge);
    });
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    expect(field('卡片 2 正面').value).toBe('Q2');

    // Notes and cards share the side panel position; one replaces the other.
    await act(async () => {
      fireEvent.click(noteBadge);
    });
    expect(screen.queryByRole('complementary', { name: 'Anki 卡片' })).toBeNull();
    expect(screen.getByRole('complementary', { name: '节点备注' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(badge);
    });
    expect(screen.queryByRole('complementary', { name: '节点备注' })).toBeNull();
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
        fireEvent(field('卡片 1 背面'), event);
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
