// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoardTransforms,
  createTestingBoard,
  PlaitBoard,
  PlaitPointerType,
} from '@plait/core';
import { buildDrawnixHotkeyPlugin } from './with-hotkey';

function hotkeyBoard(focused: () => boolean) {
  const updateAppState = vi.fn();
  const board = createTestingBoard(
    [buildDrawnixHotkeyPlugin(updateAppState, focused)],
    []
  );
  return { board, updateAppState };
}

/** The key a document listener would hand to `board.globalKeyDown`. */
function press(
  board: PlaitBoard,
  init: KeyboardEventInit & { target?: EventTarget | null }
) {
  // Plain event object: jsdom KeyboardEvent modifier getters are unreliable
  // when the event is synthesized and not dispatched.
  const event = {
    key: init.key ?? '',
    ctrlKey: !!init.ctrlKey,
    metaKey: !!init.metaKey,
    shiftKey: !!init.shiftKey,
    altKey: !!init.altKey,
    // Prefer no target: a real <body> can match editable selectors in crowded tests.
    target: init.target ?? null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  board.globalKeyDown(event as unknown as KeyboardEvent);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Drawnix hotkey focus scope', () => {
  it('switches tools with a key while the editor has focus', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    press(board, { key: 'h' });
    expect(board.pointer).toBe(PlaitPointerType.hand);
    expect(updateAppState).toHaveBeenCalledWith({
      pointer: PlaitPointerType.hand,
    });
  });

  it('ignores tool keys while focus is on a host control outside the editor', () => {
    const { board, updateAppState } = hotkeyBoard(() => false);
    const before = board.pointer;
    press(board, { key: 'h' });
    expect(board.pointer).toBe(before);
    expect(updateAppState).not.toHaveBeenCalled();
  });

  it('keeps ignoring keys while board text was just being edited', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    vi.spyOn(PlaitBoard, 'hasBeenTextEditing').mockReturnValue(true);
    const before = board.pointer;
    press(board, { key: 'h' });
    expect(board.pointer).toBe(before);
    expect(updateAppState).not.toHaveBeenCalled();
  });

  it('does not steal letter keys from the theme <select>', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    const select = document.createElement('select');
    document.body.appendChild(select);
    const before = board.pointer;
    const event = press(board, { key: 'r', target: select });
    expect(board.pointer).toBe(before);
    expect(updateAppState).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps tool keys after a toolbar <button> click leaves focus on the button', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    press(board, { key: 'h', target: button });
    expect(board.pointer).toBe(PlaitPointerType.hand);
    expect(updateAppState).toHaveBeenCalledWith({
      pointer: PlaitPointerType.hand,
    });
  });


  it('zooms with Ctrl/Cmd +/- under focus even without pointer over the board', () => {
    const { board } = hotkeyBoard(() => true);
    // Testing boards have no viewport host; stub zoom so we only assert routing.
    vi.spyOn(BoardTransforms, 'updateZoom').mockImplementation((b, zoom) => {
      b.viewport = { ...b.viewport, zoom };
    });
    vi.spyOn(BoardTransforms, 'fitViewport').mockImplementation(() => undefined);
    expect(board.viewport.zoom).toBe(1);
    // Send both meta and ctrl: `mod` is platform-dependent.
    const zoomIn = press(board, { key: '=', metaKey: true, ctrlKey: true });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(board.viewport.zoom).toBeCloseTo(1.1);
    const zoomOut = press(board, { key: '-', metaKey: true, ctrlKey: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(board.viewport.zoom).toBeCloseTo(1);
    const reset = press(board, { key: '0', metaKey: true, ctrlKey: true });
    expect(reset.defaultPrevented).toBe(true);
    expect(board.viewport.zoom).toBe(1);
  });
});
