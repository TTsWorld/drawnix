// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSelectedElement,
  BoardTransforms,
  clearSelectedElement,
  PlaitBoard,
  type PlaitElement,
  PlaitPointerType,
  ThemeColorMode,
} from '@plait/core';
import { BasicShapes } from '@plait/draw';
import { MindPointerType, MindThemeColors } from '@plait/mind';
import { FreehandShape } from '../plugins/freehand/type';
import { createMindmapDocument } from '../editor';
import { MindmapAnkiCards } from './mindmap-anki-cards';
import { MindmapNotes } from './mindmap-notes';
import {
  getNodeActionSize,
  getNodeActionStrip,
  hitNodeRect,
  NODE_ACTION_EXIT_DURATION,
  NODE_ACTION_FIT_MIN_SIZE,
  placeNodeActions,
} from './mindmap-node-actions';
import type { MindNodeRect } from './mindmap-widgets';
import {
  getAccentTextColor,
  getLuminance,
  NODE_ACCENT_DARK_TEXT,
} from './mindmap-node-accent';
import {
  nodeAction,
  nodeActions,
  renderMindmapWidgets,
  selectMindNode,
} from '../testing/mindmap-widget-harness';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll('.drawnix').forEach((host) => host.remove());
});

/** Root "Original" with a note and two cards; child "Child" is empty. */
async function setup({ content = true } = {}) {
  const document = createMindmapDocument('# Original\n## Child');
  const root = document.elements[0] as PlaitElement;
  if (content) {
    root.note = 'n';
    root.ankiCards = [
      { id: 'c1', front: 'Q1', back: 'A1' },
      { id: 'c2', front: 'Q2', back: 'A2' },
    ];
  }
  const result = await renderMindmapWidgets(document.elements, () => ({}), [
    <MindmapNotes key="notes" />,
    <MindmapAnkiCards key="cards" />,
  ]);
  const host = PlaitBoard.getBoardContainer(result.board);
  const childId = result.editor.readMindmap()[0].children[0].id;
  return { ...result, host, childId };
}

const bars = () => screen.queryAllByRole('toolbar');
const dot = (id: string) =>
  window.document.querySelector<HTMLElement>(
    `.drawnix-node-content-dot[data-node-id="${id}"]`
  );
// jsdom has no PointerEvent; a MouseEvent carries the coordinates.
const pointer = (target: Element, type: string, init: MouseEventInit = {}) =>
  act(async () => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    );
  });

describe('node action buttons', () => {
  it('keeps nodes clean at rest, with only a hidden dot on nodes with content', async () => {
    const { id, childId } = await setup();
    expect(bars()).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
    const rootDot = dot(id) as HTMLElement;
    // Top-right corner of the fake 100 × 40 node at (100, 100).
    expect(rootDot.style.left).toBe('200px');
    expect(rootDot.style.top).toBe('100px');
    expect(rootDot.getAttribute('aria-hidden')).toBe('true');
    expect(dot(childId)).toBeNull();
  });

  it('shows the buttons of the hovered node on its bottom edge and hides them after it leaves', async () => {
    vi.useFakeTimers();
    const { host, id } = await setup();
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    // Harness nodes overlap; the last listed one (the root) wins.
    const bar = screen.getByRole('toolbar', { name: '节点操作: Original' });
    expect(bar.style.left).toBe('150px');
    // On the bottom border at 140 (the CSS moves it up by half its height),
    // as far into the node as the root's 10px text padding allows: 9px of
    // the 11px half, so the center is 2px below the border.
    expect(bar.style.top).toBe('142px');
    // The buttons show the state; the dot gives way.
    expect(dot(id)).toBeNull();

    // The strip under the node holds the buttons and still counts as hovered.
    await pointer(host, 'pointermove', { clientX: 150, clientY: 153 });
    expect(bars()).toHaveLength(1);

    // Leaving waits briefly so the pointer can cross the gap to the buttons.
    await pointer(host, 'pointermove', { clientX: 400, clientY: 400 });
    expect(bars()).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(bars()).toHaveLength(0);

    // Moving on over the blank board does not keep the buttons (Codex review 8).
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    for (let i = 0; i < 4; i++) {
      await pointer(host, 'pointermove', { clientX: 400 + i, clientY: 400 });
      await act(async () => {
        vi.advanceTimersByTime(60);
      });
    }
    expect(bars()).toHaveLength(0);
    // Coming back before the delay ends keeps them.
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    await pointer(host, 'pointermove', { clientX: 400, clientY: 400 });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(bars()).toHaveLength(1);
    await pointer(host, 'pointerleave');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(bars()).toHaveLength(0);
  });

  it('hides while the pointer is held on the board', async () => {
    const { host, board, id } = await setup();
    await selectMindNode(board, id);
    expect(bars()).toHaveLength(1);
    // Dragging or moving the selection: the buttons would trail behind.
    await pointer(host, 'pointerdown', { clientX: 150, clientY: 120 });
    expect(bars()).toHaveLength(0);
    await pointer(window.document.body, 'pointerup');
    expect(bars()).toHaveLength(1);
    // Pressing a node button is not a board press.
    await pointer(nodeAction('Original', '打开备注'), 'pointerdown');
    expect(bars()).toHaveLength(1);
  });

  it('shows the state of the selected node and none for a multiple selection', async () => {
    const { board, id, childId } = await setup();
    await selectMindNode(board, id);
    const note = nodeAction('Original', '打开备注');
    const cards = nodeAction('Original', '打开 Anki 卡片 (2)');
    expect(note.classList).toContain('drawnix-node-action--filled');
    expect(cards.classList).toContain('drawnix-node-action--filled');
    expect(cards.querySelector('.drawnix-node-action__count')?.textContent).toBe(
      '2'
    );
    expect(note.getAttribute('aria-expanded')).toBe('false');
    expect(dot(id)).toBeNull();

    await selectMindNode(board, childId);
    expect(nodeAction('Child', '添加备注').classList).not.toContain(
      'drawnix-node-action--filled'
    );
    const empty = nodeAction('Child', '添加 Anki 卡片');
    expect(empty.title).toBe('添加 Anki 卡片');
    expect(empty.querySelector('.drawnix-node-action__count')).toBeNull();
    // The root's buttons fade out, out of reach, before its dot comes back.
    const ghost = window.document.querySelector<HTMLElement>(
      `[data-leaving-node-id="${id}"]`
    ) as HTMLElement;
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelector('button')).toBeNull();
    expect(dot(id)).toBeNull();
    await act(
      () =>
        new Promise((resolve) =>
          setTimeout(resolve, NODE_ACTION_EXIT_DURATION + 20)
        )
    );
    expect(ghost.isConnected).toBe(false);
    expect(dot(id)).toBeTruthy();

    await act(async () => {
      const [root] = board.children;
      addSelectedElement(board, root);
      board.afterChange();
    });
    expect(bars()).toHaveLength(0);
  });

  it('opens and closes panels from the buttons and keeps the open node buttons', async () => {
    const { board, id, childId } = await setup();
    await selectMindNode(board, id);
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开 Anki 卡片 (2)'));
    });
    expect(
      screen.getByRole('complementary', { name: 'Anki 卡片' })
    ).toBeTruthy();
    expect(
      nodeAction('Original', '打开 Anki 卡片 (2)').getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      nodeAction('Original', '打开 Anki 卡片 (2)').classList
    ).toContain('drawnix-node-action--open');

    // Selecting another node leaves the open node's buttons in place.
    await selectMindNode(board, childId);
    expect(nodeActions('Original')).toBeTruthy();
    expect(nodeActions('Child')).toBeTruthy();
    await act(async () => {
      fireEvent.click(nodeAction('Child', '添加备注'));
    });
    expect(screen.getByRole('complementary', { name: '节点备注' })).toBeTruthy();
    expect(
      screen.queryByRole('complementary', { name: 'Anki 卡片' })
    ).toBeNull();
    expect(screen.queryByRole('toolbar', { name: '节点操作: Original' })).toBeNull();

    // A press on the button does not count as outside the panel; the click
    // after it closes the panel.
    await pointer(nodeAction('Child', '添加备注'), 'pointerdown');
    expect(screen.getByRole('complementary')).toBeTruthy();
    await act(async () => {
      fireEvent.click(nodeAction('Child', '添加备注'));
    });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows no buttons with drawing, shape or hand tools (Codex review 8)', async () => {
    const { board, host, id } = await setup();
    await selectMindNode(board, id);
    await act(async () => {
      fireEvent.click(nodeAction('Original', '打开备注'));
    });
    expect(bars()).toHaveLength(1);
    for (const tool of [
      FreehandShape.feltTipPen,
      PlaitPointerType.hand,
      BasicShapes.rectangle,
      MindPointerType.mind,
    ]) {
      await act(async () => {
        BoardTransforms.updatePointerType(board, tool);
        board.afterChange();
      });
      // Not for the selection, the hovered node or the open panel's node.
      expect(bars()).toHaveLength(0);
      await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
      expect(bars()).toHaveLength(0);
    }
    await act(async () => {
      BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
      board.afterChange();
    });
    expect(bars()).toHaveLength(1);
  });

  it('hides the buttons of hovered and selected nodes while text is edited', async () => {
    const { board, host, id } = await setup();
    await selectMindNode(board, id);
    expect(bars()).toHaveLength(1);
    const editing = vi
      .spyOn(PlaitBoard, 'hasBeenTextEditing')
      .mockReturnValue(true);
    await act(async () => {
      board.afterChange();
    });
    expect(bars()).toHaveLength(0);
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    expect(bars()).toHaveLength(0);
    editing.mockReturnValue(false);
    await act(async () => {
      board.afterChange();
    });
    expect(bars()).toHaveLength(1);
  });

  it('shows no buttons in read-only mode, keeping the resting dot', async () => {
    const { board, host, id } = await setup();
    board.options.readonly = true;
    await selectMindNode(board, id);
    expect(bars()).toHaveLength(0);
    await pointer(host, 'pointermove', { clientX: 150, clientY: 120 });
    expect(bars()).toHaveLength(0);
    expect(dot(id)).toBeTruthy();
  });

  describe('keyboard', () => {
    async function focusedSetup() {
      const result = await setup();
      window.document.body.append(result.host);
      result.host.tabIndex = -1;
      result.host.focus();
      await selectMindNode(result.board, result.id);
      return result;
    }

    it('moves focus to the selected node buttons with Alt+Enter', async () => {
      const { host } = await focusedSetup();
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const note = nodeAction('Original', '打开备注');
      expect(window.document.activeElement).toBe(note);
      // One Tab stop for the row; arrows move inside it.
      expect(note.tabIndex).toBe(0);
      expect(nodeAction('Original', '打开 Anki 卡片 (2)').tabIndex).toBe(-1);
    });

    it.each([
      ['Enter without Alt', { key: 'Enter' }],
      ['Alt+Shift+Enter', { key: 'Enter', altKey: true, shiftKey: true }],
      ['Ctrl+Alt+Enter', { key: 'Enter', altKey: true, ctrlKey: true }],
    ])('leaves %s to the board', async (_name, init) => {
      const { host } = await focusedSetup();
      const event = new KeyboardEvent('keydown', {
        ...init,
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(window.document.activeElement).toBe(host);
    });

    it('leaves Alt+Enter in text fields alone', async () => {
      const { host } = await focusedSetup();
      const input = window.document.createElement('textarea');
      host.append(input);
      input.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(window.document.activeElement).toBe(input);
    });

    it('does nothing without a single selected node', async () => {
      const { host, board } = await focusedSetup();
      await act(async () => {
        clearSelectedElement(board);
        board.afterChange();
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('moves between buttons with arrows, activates them and returns to the board with Escape', async () => {
      const { host } = await focusedSetup();
      const note = nodeAction('Original', '打开备注');
      const cards = nodeAction('Original', '打开 Anki 卡片 (2)');
      note.focus();
      fireEvent.keyDown(note, { key: 'ArrowRight' });
      expect(window.document.activeElement).toBe(cards);
      fireEvent.keyDown(cards, { key: 'ArrowRight' });
      expect(window.document.activeElement).toBe(note);
      fireEvent.keyDown(note, { key: 'ArrowLeft' });
      expect(window.document.activeElement).toBe(cards);
      fireEvent.keyDown(cards, { key: 'Home' });
      expect(window.document.activeElement).toBe(note);
      fireEvent.keyDown(note, { key: 'End' });
      expect(window.document.activeElement).toBe(cards);

      // Native buttons: Enter and Space click.
      await act(async () => {
        fireEvent.click(cards);
      });
      expect(
        screen.getByRole('complementary', { name: 'Anki 卡片' })
      ).toBeTruthy();
      await act(async () => {
        fireEvent.click(nodeAction('Original', '打开 Anki 卡片 (2)'));
      });
      expect(screen.queryByRole('complementary')).toBeNull();

      const button = nodeAction('Original', '打开备注');
      button.focus();
      fireEvent.keyDown(button, { key: 'Escape' });
      expect(window.document.activeElement).toBe(host);
    });

    it('runs board undo and redo from the buttons', async () => {
      const { board, editor, id } = await focusedSetup();
      await act(async () => {
        editor.updateMindmap([{ type: 'set_note', nodeId: id, note: 'm' }]);
      });
      const note = nodeAction('Original', '打开备注');
      note.focus();
      await act(async () => {
        fireEvent.keyDown(note, { key: 'z', ctrlKey: true });
      });
      expect(editor.readMindmap()[0].note).toBe('n');
      await act(async () => {
        fireEvent.keyDown(nodeAction('Original', '打开备注'), {
          key: 'Z',
          metaKey: true,
          shiftKey: true,
        });
      });
      expect(editor.readMindmap()[0].note).toBe('m');
      expect(board.history.redos).toHaveLength(0);
    });

    it('keeps keys on the buttons away from the board', async () => {
      await focusedSetup();
      const note = nodeAction('Original', '打开备注');
      // Plait inserts a child on Tab and deletes the node on Delete.
      const boardListener = vi.fn();
      window.addEventListener('keydown', boardListener);
      try {
        for (const key of ['Tab', 'Delete', 'Enter', 'ArrowRight', 'a', 'z']) {
          fireEvent.keyDown(note, { key });
        }
        expect(boardListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', boardListener);
      }
    });
  });
});

describe('node action colors', () => {
  const layer = () =>
    window.document.querySelector<HTMLElement>(
      '.drawnix-node-actions-layer'
    ) as HTMLElement;
  const accentOf = (element: HTMLElement | null) =>
    element?.style.getPropertyValue('--drawnix-node-accent');

  it('takes the node stroke or branch color, and a readable one for the root', async () => {
    const { board, id, childId } = await setup();
    expect(layer().dataset.canvas).toBe('light');
    expect(layer().style.getPropertyValue('--drawnix-canvas')).toBe('#ffffff');
    // The default root stroke is its #f5f5f5 fill, lost on white: text color.
    expect(accentOf(dot(id))).toBe('#333333');
    await selectMindNode(board, childId);
    // First branch color of the default theme.
    expect(accentOf(nodeActions('Child'))).toBe('#A287E0');
    expect(
      nodeActions('Child').style.getPropertyValue('--drawnix-node-accent-text')
    ).toBe('#ffffff');
  });

  it('follows the theme, with a dark canvas on dark themes', async () => {
    const { board, id, childId } = await setup();
    // As Drawnix configures its board.
    board.options.themeColors = MindThemeColors;
    await act(async () => {
      BoardTransforms.updateThemeColor(board, ThemeColorMode.dark);
    });
    expect(layer().dataset.canvas).toBe('dark');
    expect(layer().style.getPropertyValue('--drawnix-canvas')).toBe('#141414');
    // The white root reads on the dark canvas.
    expect(accentOf(dot(id))).toBe('#FFFFFF');
    await selectMindNode(board, childId);
    expect(accentOf(nodeActions('Child'))).toBe('#3DD1AE');
  });

  it('hides the dot of the selected node, whose buttons show instead', async () => {
    const { board, id } = await setup();
    expect(dot(id)).toBeTruthy();
    await selectMindNode(board, id);
    expect(dot(id)).toBeNull();
    expect(accentOf(nodeActions('Original'))).toBe('#333333');
  });

  it('puts dark text on light accents in the count badge', () => {
    expect(getAccentTextColor('#A287E0')).toBe('#ffffff');
    expect(getAccentTextColor('#333333')).toBe('#ffffff');
    // Yellow branch and the white root of dark themes.
    expect(getAccentTextColor('#E0B75E')).toBe(NODE_ACCENT_DARK_TEXT);
    expect(getAccentTextColor('#FFFFFF')).toBe(NODE_ACCENT_DARK_TEXT);
    // Colors that cannot be measured keep the default.
    expect(getAccentTextColor('rebeccapurple')).toBe('#ffffff');
  });

  it('measures hex colors with or without alpha and padding', () => {
    expect(getLuminance('#fff')).toBe(1);
    expect(getLuminance('#00000080')).toBe(0);
    expect(getLuminance('#FF877B ')).toBeCloseTo(0.4, 1);
    expect(getLuminance('rgb(0, 0, 0)')).toBeNull();
  });
});

describe('node action geometry', () => {
  const rect = (id: string, top: number): MindNodeRect => ({
    id,
    topic: id,
    left: 0,
    top,
    right: 100,
    bottom: top + 30,
    hasNote: false,
    cardCount: 0,
    // Roomy padding: more than half a button between text and border.
    contentTop: top + 12,
    contentBottom: top + 18,
    accent: '#A287E0',
  });

  it('counts the press areas and the half of the row outside the node', () => {
    const rects = [rect('a', 0)];
    const placement = placeNodeActions(rects[0], rects, 22);
    // 22px buttons with 3px press areas around them, centered on y = 30.
    expect(getNodeActionStrip(placement)).toEqual({ top: 16, bottom: 44 });
    expect(getNodeActionStrip(placeNodeActions(rects[0], rects, 18))).toEqual({
      top: 18,
      bottom: 42,
    });
  });

  it('keeps a fixed screen size at and above 100% and shrinks to a minimum below', () => {
    expect(getNodeActionSize(1)).toBe(22);
    expect(getNodeActionSize(4)).toBe(22);
    expect(getNodeActionSize(0.9)).toBe(20);
    expect(getNodeActionSize(0.5)).toBe(18);
    expect(getNodeActionSize(0.1)).toBe(18);
  });

  it('counts the strip of the hovered node buttons only for that node', () => {
    const rects = [rect('a', 0), rect('b', 60)];
    const strip = { id: 'a', top: 26, bottom: 48 };
    expect(hitNodeRect(rects, 50, 10, null)).toBe('a');
    expect(hitNodeRect(rects, 50, 45, null)).toBeNull();
    expect(hitNodeRect(rects, 50, 45, strip)).toBe('a');
    expect(hitNodeRect(rects, 50, 45, { id: 'b', top: 86, bottom: 108 })).toBeNull();
    expect(hitNodeRect(rects, 50, 70, strip)).toBe('b');
    expect(hitNodeRect(rects, 150, 10, strip)).toBeNull();
    // Buttons on the top edge stick out above.
    expect(hitNodeRect(rects, 50, 50, { id: 'b', top: 42, bottom: 64 })).toBe(
      'b'
    );
  });

  describe('placing the buttons', () => {
    // A 30px tall node with neighbours `gap` px above and below.
    const stack = (gap: number) => [
      rect('up', 0),
      rect('mid', 30 + gap),
      rect('down', 60 + 2 * gap),
    ];
    const mid = (rects: MindNodeRect[]) => rects[1];
    // The row takes size / 2 + 3 (press area) + 2 (clearance) outside the node.

    it('centers them on the bottom edge when there is room', () => {
      const rects = stack(30);
      expect(placeNodeActions(mid(rects), rects, 22)).toEqual({
        x: 50,
        y: 90,
        size: 22,
        side: 'below',
      });
      // Exactly enough room: 11 + 3 + 2.
      expect(placeNodeActions(mid(stack(16)), stack(16), 22).side).toBe('below');
      // One pixel short on both sides: a size that fits, 2 × (15 - 3 - 2).
      expect(placeNodeActions(mid(stack(15)), stack(15), 22).size).toBe(20);
      // The last node has nothing below.
      expect(placeNodeActions(rects[2], stack(1), 22).side).toBe('below');
    });

    it('moves them to the top edge when the node below is too close', () => {
      const rects = [rect('mid', 0), rect('down', 40)];
      const placement = placeNodeActions(rects[0], rects, 22);
      expect(placement).toEqual({ x: 50, y: 0, size: 22, side: 'above' });
    });

    it('shrinks them to the larger gap when neither side has room', () => {
      const rects = [rect('up', 0), rect('mid', 44), rect('down', 86)];
      // 14px above, 12px below: 2 × (14 - 3 - 2) = 18 above.
      expect(placeNodeActions(rects[1], rects, 22)).toEqual({
        x: 50,
        y: 44,
        size: 18,
        side: 'above',
      });
    });

    it('goes into a small node only as far as its text allows', () => {
      // 5px under the text: 4px into the node, keeping 1px off the text.
      const small = { ...rect('a', 0), contentTop: 5, contentBottom: 25 };
      expect(placeNodeActions(small, [small], 22)).toEqual({
        x: 50,
        y: 30 + 11 - 4,
        size: 22,
        side: 'below',
      });
      // It then takes more room outside: 22 - 4 + 3 + 2 = 23.
      const below = (gap: number) => ({ ...rect('b', 30 + gap) });
      expect(placeNodeActions(small, [small, below(23)], 22).side).toBe(
        'below'
      );
      const above = placeNodeActions(small, [small, below(22)], 22);
      expect(above).toEqual({ x: 50, y: -(11 - 4), size: 22, side: 'above' });
      // Text touching the border: the buttons sit under it.
      const full = { ...small, contentTop: 0, contentBottom: 30 };
      expect(placeNodeActions(full, [full], 22).y).toBe(41);
    });

    it('keeps a minimum size far zoomed out', () => {
      const rects = stack(4);
      const placement = placeNodeActions(mid(rects), rects, 18);
      expect(placement.size).toBe(NODE_ACTION_FIT_MIN_SIZE);
      expect(placement.side).toBe('below');
    });

    it('ignores nodes beside the buttons and the node itself', () => {
      const beside = { ...rect('beside', 35), left: 200, right: 300 };
      const rects = [rect('mid', 0), beside];
      expect(placeNodeActions(rects[0], rects, 22).side).toBe('below');
    });
  });
});
