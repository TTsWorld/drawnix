import {
  BoardTransforms,
  getSelectedElements,
  PlaitBoard,
  PlaitPointerType,
} from '@plait/core';
import { isHotkey } from 'is-hotkey';
import { addImage, saveAsImage } from '../utils/image';
import { saveAsJSON } from '../data/json';
import { DrawnixState } from '../hooks/use-drawnix';
import { BoardCreationMode, setCreationMode } from '@plait/common';
import { MindPointerType } from '@plait/mind';
import { FreehandShape } from './freehand/type';
import { ArrowLineShape, BasicShapes } from '@plait/draw';

/** Form controls / contenteditable where letter keys belong to the control.
 * Toolbar <button>s are not excluded: after clicking zoom/undo/etc. the button
 * may keep focus inside the editor, and letter tool keys / Cmd+S must still work.
 */
function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  );
}

export const buildDrawnixHotkeyPlugin = (
  updateAppState: (appState: Partial<DrawnixState>) => void,
  /** Whether this editor's container has focus, so shortcuts are in scope. */
  isEditorFocused: () => boolean = () => true
) => {
  const withDrawnixHotkey = (board: PlaitBoard) => {
    const { globalKeyDown, keyDown } = board;
    board.globalKeyDown = (event: KeyboardEvent) => {
      // Exclude <select> and other form controls: theme typeahead must keep
      // letter keys, and contenteditable must keep typing.
      const isTypingNormal = isEditableShortcutTarget(event.target);
      if (
        !isTypingNormal &&
        isEditorFocused() &&
        !PlaitBoard.hasBeenTextEditing(board)
      ) {
        if (isHotkey(['mod+shift+e'], { byKey: true })(event)) {
          void saveAsImage(board, true);
          event.preventDefault();
          return;
        }
        if (isHotkey(['mod+s'], { byKey: true })(event)) {
          void saveAsJSON(board);
          event.preventDefault();
          return;
        }
        if (
          isHotkey(['mod+backspace'])(event) ||
          isHotkey(['mod+delete'])(event)
        ) {
          updateAppState({
            openCleanConfirm: true,
          });
          event.preventDefault();
          return;
        }
        if (isHotkey(['mod+u'])(event)) {
          void addImage(board);
          event.preventDefault();
          return;
        }
        // Plait's own zoom hotkeys also require the pointer to be over the
        // board. Handle them here under the focus scope so Ctrl/Cmd +/- / 0
        // zoom the board (and preventDefault stops the browser page zoom)
        // after a click, even when the pointer has left the canvas. Match
        // Plait's key set explicitly: is-hotkey's `mod+=` is flaky for `=` in
        // some environments.
        const mod = event.metaKey || event.ctrlKey;
        if (mod && !event.altKey) {
          const key = event.key;
          if (!event.shiftKey && (key === '=' || key === '+')) {
            event.preventDefault();
            BoardTransforms.updateZoom(board, board.viewport.zoom + 0.1);
            return;
          }
          if (event.shiftKey && (key === '=' || key === '+')) {
            event.preventDefault();
            BoardTransforms.fitViewport(board);
            return;
          }
          if (key === '-' || key === '_') {
            event.preventDefault();
            BoardTransforms.updateZoom(board, board.viewport.zoom - 0.1);
            return;
          }
          if (key === '0') {
            event.preventDefault();
            BoardTransforms.updateZoom(board, 1);
            return;
          }
        }
        if (!event.altKey && !event.metaKey && !event.ctrlKey) {
          if (event.key === 'h') {
            BoardTransforms.updatePointerType(board, PlaitPointerType.hand);
            updateAppState({ pointer: PlaitPointerType.hand });
            event.preventDefault();
            return;
          }
          if (event.key === 'v') {
            BoardTransforms.updatePointerType(
              board,
              PlaitPointerType.selection
            );
            updateAppState({ pointer: PlaitPointerType.selection });
            event.preventDefault();
            return;
          }
          if (event.key === 'm') {
            setCreationMode(board, BoardCreationMode.dnd);
            BoardTransforms.updatePointerType(board, MindPointerType.mind);
            updateAppState({ pointer: MindPointerType.mind });
            event.preventDefault();
            return;
          }
          if (event.key === 'e') {
            setCreationMode(board, BoardCreationMode.drawing);
            BoardTransforms.updatePointerType(board, FreehandShape.eraser);
            updateAppState({ pointer: FreehandShape.eraser });
            event.preventDefault();
            return;
          }
          if (event.key === 'p') {
            setCreationMode(board, BoardCreationMode.drawing);
            BoardTransforms.updatePointerType(board, FreehandShape.feltTipPen);
            updateAppState({ pointer: FreehandShape.feltTipPen });
            event.preventDefault();
            return;
          }
          if (event.key === 'a' && !isHotkey(['mod+a'])(event)) {
            // will trigger editing text
            if (getSelectedElements(board).length === 0) {
              setCreationMode(board, BoardCreationMode.drawing);
              BoardTransforms.updatePointerType(board, ArrowLineShape.straight);
              updateAppState({ pointer: ArrowLineShape.straight });
              event.preventDefault();
              return;
            }
          }
          if (event.key === 'r' || event.key === 'o' || event.key === 't') {
            const keyToPointer = {
              r: BasicShapes.rectangle,
              o: BasicShapes.ellipse,
              t: BasicShapes.text,
            };
            if (keyToPointer[event.key] === BasicShapes.text) {
              setCreationMode(board, BoardCreationMode.dnd);
            } else {
              setCreationMode(board, BoardCreationMode.drawing);
            }
            BoardTransforms.updatePointerType(board, keyToPointer[event.key]);
            updateAppState({ pointer: keyToPointer[event.key] });
            event.preventDefault();
            return;
          }
        }
      }
      globalKeyDown(event);
    };

    board.keyDown = (event: KeyboardEvent) => {
      if (isHotkey(['mod+z'], { byKey: true })(event)) {
        board.undo();
        event.preventDefault();
        return;
      }

      if (isHotkey(['mod+shift+z'], { byKey: true })(event)) {
        board.redo();
        event.preventDefault();
        return;
      }

      keyDown(event);
    };

    return board;
  };
  return withDrawnixHotkey;
};
