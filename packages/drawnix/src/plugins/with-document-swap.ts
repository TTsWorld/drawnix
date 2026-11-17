import type { PlaitBoard } from '@plait/core';

const STATE = new WeakMap<
  PlaitBoard,
  { children: PlaitBoard['children']; generation: number }
>();
// Separate from STATE: plugins registered earlier subscribe before this one runs.
const LISTENERS = new WeakMap<PlaitBoard, Array<() => void>>();

/**
 * Detects a document swap: `board.children` replaced without an operation,
 * as react-board's Wrapper does when the host passes a new `value`, and as
 * Open File does. Operations always produce `board.children` through
 * `board.apply`, so children that differ from the last ones seen after an
 * operation came from outside.
 *
 * On a swap the undo history is cleared (its operations belong to the
 * previous document; this also forgets every cut made there, see
 * withAnkiCards), the document generation advances (pending asynchronous
 * writes such as card images check it and drop themselves) and listeners
 * run (duplicate card ID repair).
 *
 * Register it last, so that its checks run before every other plugin's
 * `apply`, `undo`, `redo` and `insertFragment`.
 */
export const withDocumentSwap = (board: PlaitBoard) => {
  const { apply, undo, redo, insertFragment } = board;
  STATE.set(board, { children: board.children, generation: 0 });
  board.apply = (operation) => {
    syncDocumentSwap(board);
    apply(operation);
    const state = STATE.get(board);
    if (state) state.children = board.children;
  };
  // Undo and redo read the history before applying; check first.
  board.undo = () => {
    syncDocumentSwap(board);
    undo();
  };
  board.redo = () => {
    syncDocumentSwap(board);
    redo();
  };
  board.insertFragment = (...args) => {
    syncDocumentSwap(board);
    insertFragment(...args);
  };
  return board;
};

/**
 * Handles a document swap if one happened since the last check. Returns
 * whether it did. Safe to call at any time, also on boards without the
 * plugin (it then does nothing).
 */
export function syncDocumentSwap(board: PlaitBoard): boolean {
  const state = STATE.get(board);
  if (!state || state.children === board.children) return false;
  state.children = board.children;
  state.generation++;
  if (board.history) board.history = { undos: [], redos: [] };
  LISTENERS.get(board)?.forEach((listener) => listener());
  return true;
}

/** Advances on every document swap; 0 on boards without the plugin. */
export function getDocumentGeneration(board: PlaitBoard): number {
  syncDocumentSwap(board);
  return STATE.get(board)?.generation ?? 0;
}

/** Runs `listener` after each document swap on this board. */
export function onDocumentSwap(board: PlaitBoard, listener: () => void) {
  const listeners = LISTENERS.get(board) ?? [];
  listeners.push(listener);
  LISTENERS.set(board, listeners);
}
