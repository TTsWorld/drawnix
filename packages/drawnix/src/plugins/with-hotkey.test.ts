// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
function press(board: PlaitBoard, key: string) {
  board.globalKeyDown(new KeyboardEvent('keydown', { key }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Drawnix hotkey focus scope', () => {
  it('switches tools with a key while the editor has focus', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    press(board, 'h');
    expect(board.pointer).toBe(PlaitPointerType.hand);
    expect(updateAppState).toHaveBeenCalledWith({
      pointer: PlaitPointerType.hand,
    });
  });

  it('ignores tool keys while focus is on a host control outside the editor', () => {
    const { board, updateAppState } = hotkeyBoard(() => false);
    const before = board.pointer;
    press(board, 'h');
    expect(board.pointer).toBe(before);
    expect(updateAppState).not.toHaveBeenCalled();
  });

  it('keeps ignoring keys while board text was just being edited', () => {
    const { board, updateAppState } = hotkeyBoard(() => true);
    vi.spyOn(PlaitBoard, 'hasBeenTextEditing').mockReturnValue(true);
    const before = board.pointer;
    press(board, 'h');
    expect(board.pointer).toBe(before);
    expect(updateAppState).not.toHaveBeenCalled();
  });
});
