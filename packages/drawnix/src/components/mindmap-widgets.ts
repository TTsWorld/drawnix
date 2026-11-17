// Shared behavior of node widgets (notes, Anki cards): side panel events,
// typing history, and node geometry for the node action bar.
import {
  type Dispatch,
  type HTMLAttributes,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BoardContext } from '@plait-board/react-board';
import {
  findElements,
  FLUSHING,
  getRectangleByElements,
  PlaitBoard,
  PlaitHistoryBoard,
  type PlaitOperation,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
  Transforms,
} from '@plait/core';
import {
  getDefaultFontSizeForMindElement,
  MindElement,
  NodeSpace,
  type PlaitMindBoard,
} from '@plait/mind';
import { Node } from 'slate';
import { nodeHasAnkiCards } from '../anki-cards';
import { findElementById, findElementPathById } from '../mind-tree';
import type { DrawnixState } from '../hooks/use-drawnix';
import { getCanvasColor, getNodeAccent } from './mindmap-node-accent';

export type MindWidget = 'note' | 'ankiCards';

/** Only one widget panel is open at a time; they share the same place. */
export function openMindWidget(
  setAppState: Dispatch<SetStateAction<DrawnixState>>,
  widget: MindWidget | null,
  nodeId: string | null = null
) {
  setAppState((state) => ({
    ...state,
    openNoteId: widget === 'note' ? nodeId : null,
    openAnkiCardsId: widget === 'ankiCards' ? nodeId : null,
  }));
}

/**
 * Resolve by ID against the current document: Agent edits can move nodes.
 * Nodes in collapsed branches are found too, so collapsing an ancestor does
 * not close their panel.
 */
export function findMindElement(
  board: PlaitBoard,
  id: string | null | undefined
): MindElement | undefined {
  if (!id) return undefined;
  const element = findElementById(board.children, id);
  return element && MindElement.isMindElement(board, element)
    ? element
    : undefined;
}

/**
 * Path of a node for a panel write. Panels stay open for nodes inside a
 * collapsed branch; Plait does not keep render paths for node objects created
 * there, so `PlaitBoard.findPath` would throw on the second edit.
 */
export function findMindElementPath(
  board: PlaitBoard,
  element: MindElement
): number[] {
  const path = findElementPathById(board.children, element.id);
  if (!path) {
    throw new Error(`Unable to find the path for mind node ${element.id}`);
  }
  return path;
}

/**
 * Sets node properties from a text input. Continuous input on the same field
 * becomes one undo step; `lastInputOperation` must be reset when the input
 * loses focus or another edit starts a new step.
 */
export function setNodeFromInput(
  board: PlaitBoard,
  element: MindElement,
  properties: Partial<MindElement>,
  lastInputOperation: MutableRefObject<PlaitOperation | null>
) {
  const previousBatch = board.history.undos[board.history.undos.length - 1];
  const previousOperation = previousBatch?.[previousBatch.length - 1];
  const shouldMerge =
    lastInputOperation.current &&
    previousOperation === lastInputOperation.current &&
    board.history.redos.length === 0;
  const updateHistory = shouldMerge
    ? PlaitHistoryBoard.withMerging
    : PlaitHistoryBoard.withNewBatch;
  updateHistory(board, () => {
    Transforms.setNode(board, properties, findMindElementPath(board, element));
  });
  const batch = board.history.undos[board.history.undos.length - 1];
  const operation = batch[batch.length - 1];
  if (
    shouldMerge &&
    previousOperation?.type === 'set_node' &&
    operation.type === 'set_node'
  ) {
    // Properties hold full values; retain only the first and latest values.
    batch.splice(batch.length - 2, 2, {
      ...previousOperation,
      newProperties: operation.newProperties,
    });
  }
  lastInputOperation.current = batch[batch.length - 1];
}

/** The editor element that holds the board and its widget layers. */
function getEditorElement(board: PlaitBoard): HTMLElement | null {
  return PlaitBoard.getBoardContainer(board).closest<HTMLElement>('.drawnix');
}

export function closeMindWidgetPanel(
  board: PlaitBoard,
  setAppState: Dispatch<SetStateAction<DrawnixState>>
) {
  openMindWidget(setAppState, null);
  getEditorElement(board)?.focus({ preventScroll: true });
}

/**
 * Class of controls that open a widget panel (node action buttons).
 * Pressing one of the same editor does not count as an outside press: it
 * switches the panel.
 */
export const MIND_WIDGET_OPENER_CLASS_NAME = 'drawnix-mind-widget-opener';

/**
 * Closes the panel when a pointer goes down anywhere outside it: the board,
 * other nodes, toolbars or the host page. Everything rendered inside the
 * panel (menus, tabs, image preview) counts as inside.
 *
 * Inputs write to the document on every change, so nothing is pending except
 * an IME composition. Blurring the focused field first makes the browser
 * commit it, and its input event saves the text before the panel unmounts.
 * Closing changes no document state, so history is untouched.
 */
export function useCloseOnOutsidePointerDown(
  panel: RefObject<HTMLElement>,
  open: boolean,
  setAppState: Dispatch<SetStateAction<DrawnixState>>
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = panel.current;
      if (!element) return;
      const path = event.composedPath();
      if (path.includes(element)) return;
      // Another embedded editor's opener only changes that editor's state.
      const editor = element.closest('.drawnix');
      const opener = path.some(
        (target) =>
          target instanceof Element &&
          target.classList.contains(MIND_WIDGET_OPENER_CLASS_NAME) &&
          target.closest('.drawnix') === editor
      );
      if (opener) return;
      const active = element.ownerDocument.activeElement;
      if (active instanceof HTMLElement && element.contains(active)) {
        active.blur();
      }
      // The pressed target takes focus itself; do not move it to the board.
      openMindWidget(setAppState, null);
    };
    // Capture: the board and toolbars may stop the event before it bubbles.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [panel, open, setAppState]);
}

/**
 * Keeps pointer, wheel, clipboard and keyboard events inside the panel so the
 * board does not handle them. Escape closes; Mod+Z / Mod+Shift+Z run the
 * board history.
 */
export function getMindWidgetPanelProps(
  board: PlaitBoard,
  close: () => void,
  lastInputOperation: MutableRefObject<PlaitOperation | null>
): HTMLAttributes<HTMLElement> {
  return {
    onPointerDown: (event) => event.stopPropagation(),
    onWheel: (event) => event.stopPropagation(),
    onCopy: (event) => event.stopPropagation(),
    onCut: (event) => event.stopPropagation(),
    onPaste: (event) => event.stopPropagation(),
    onKeyDown: (event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      // Alt stays with the browser (like Plait's own hotkeys).
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        lastInputOperation.current = null;
        if (event.shiftKey) board.redo();
        else board.undo();
      }
    },
  };
}

/** Screen rectangle of a visible node, relative to the editor element. */
export interface MindNodeRect {
  id: string;
  topic: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  hasNote: boolean;
  hasCards: boolean;
  /** Top and bottom of the node's text and image, which buttons must not cover. */
  contentTop: number;
  contentBottom: number;
  /** Size of the node's text on screen, in pixels: buttons stay below it. */
  fontSize: number;
  /** The node's stroke (or branch) color, for its buttons and dot. */
  accent: string;
}

/**
 * Font size of a node's text, for sizing what sits on it: the smallest that
 * can show. The default (14, or 18 on the root) is what Drawnix renders,
 * since its text leaves ignore `font-size` marks; Plait still sizes the node
 * box from them. A run with a smaller mark counts too, so the result stays
 * at or under the text if marks are rendered one day.
 */
export function getNodeFontSize(element: MindElement): number {
  let smallest: number = getDefaultFontSizeForMindElement(element);
  for (const [text] of Node.texts(element.data.topic)) {
    if (!text.text) continue;
    const size = Number((text as { 'font-size'?: string })['font-size']);
    if (size > 0) smallest = Math.min(smallest, size);
  }
  return smallest;
}

/**
 * Space between a node's border and its content (image or text), the same at
 * the top and the bottom: Plait lays a node out as padding, image, text,
 * padding, and pads an image like text. Read from the layout, so text is not
 * measured on every board change.
 */
function getContentPadding(board: PlaitBoard, element: MindElement) {
  const mindBoard = board as PlaitMindBoard;
  const padding = MindElement.hasImage(element)
    ? NodeSpace.getImageTopSpace(mindBoard, element)
    : NodeSpace.getTextTopSpace(mindBoard, element);
  // Unknown: keep the buttons off the node.
  return Number.isFinite(padding) ? padding : 0;
}

/**
 * Screen rectangles of all visible (not collapsed away) mind-map nodes, in
 * document order, with what the node widgets need to show their state.
 * Updates after every board change, including viewport moves and zoom.
 */
export function useMindNodeRects(board: PlaitBoard): MindNodeRect[] {
  const boardVersion = useContext(BoardContext)?.v;
  const [rects, setRects] = useState<MindNodeRect[]>([]);
  const latestUpdate = useRef<() => void>(() => undefined);

  // react-board advances its version after Plait refreshes layout references.
  // A local draft render can see new children before those references exist.
  useEffect(() => {
    const host = getEditorElement(board);
    if (!host) return;
    const update = () => {
      if (FLUSHING.get(board)) return;
      const bounds = host.getBoundingClientRect();
      const toEditorPoint = (point: [number, number]) => {
        const [x, y] = toScreenPointFromHostPoint(
          board,
          toHostPointFromViewBoxPoint(board, point)
        );
        return [x - bounds.left, y - bounds.top];
      };
      const canvas = getCanvasColor(board);
      const result: MindNodeRect[] = [];
      findElements(board, {
        match: (element) => MindElement.isMindElement(board, element),
        recursion: (element) => !element.isCollapsed,
      }).forEach((element) => {
        const node = element as MindElement;
        const rect = getRectangleByElements(board, [node], false);
        const [left, top] = toEditorPoint([rect.x, rect.y]);
        const [right, bottom] = toEditorPoint([
          rect.x + rect.width,
          rect.y + rect.height,
        ]);
        const padding = getContentPadding(board, node);
        // Board units to screen pixels (the zoom), from the node's own size.
        const scale = rect.width ? (right - left) / rect.width : 1;
        const fontSize = getNodeFontSize(node) * scale;
        const [, contentTop] = toEditorPoint([rect.x, rect.y + padding]);
        const [, contentBottom] = toEditorPoint([
          rect.x,
          rect.y + rect.height - padding,
        ]);
        result.push({
          id: node.id,
          topic: Node.string(node.data.topic),
          left,
          top,
          right,
          bottom,
          hasNote: hasNote(node),
          hasCards: nodeHasAnkiCards(node),
          contentTop,
          contentBottom,
          fontSize: Number.isFinite(fontSize) ? fontSize : 0,
          accent: getNodeAccent(board, node, canvas),
        });
      });
      setRects(result);
    };
    latestUpdate.current = update;
    update();
  }, [board, boardVersion]);

  // One observer per board, not one per board change (each pan or zoom).
  useEffect(() => {
    const host = getEditorElement(board);
    if (!host) return;
    const observer = new ResizeObserver(() => latestUpdate.current());
    observer.observe(host);
    return () => observer.disconnect();
  }, [board]);

  return rects;
}

export function hasNote(element: MindElement): boolean {
  return typeof element.note === 'string' && !!element.note;
}
