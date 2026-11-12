// Shared behavior of node widgets (notes, Anki cards): side panel events,
// typing history, and badges next to nodes.
import {
  type Dispatch,
  type HTMLAttributes,
  type MutableRefObject,
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
import { MindElement } from '@plait/mind';
import { Node } from 'slate';
import type { DrawnixState } from '../hooks/use-drawnix';

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

/** Resolve by ID against the current document: Agent edits can move nodes. */
export function findMindElement(
  board: PlaitBoard,
  id: string | null | undefined
): MindElement | undefined {
  if (!id) return undefined;
  return findElements(board, {
    match: (element) =>
      element.id === id && MindElement.isMindElement(board, element),
    recursion: () => true,
  })[0] as MindElement | undefined;
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
    Transforms.setNode(board, properties, PlaitBoard.findPath(board, element));
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

export function closeMindWidgetPanel(
  board: PlaitBoard,
  setAppState: Dispatch<SetStateAction<DrawnixState>>
) {
  openMindWidget(setAppState, null);
  const host =
    PlaitBoard.getBoardContainer(board).closest<HTMLElement>('.drawnix');
  host?.focus({ preventScroll: true });
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        lastInputOperation.current = null;
        if (event.shiftKey) board.redo();
        else board.undo();
      }
    },
  };
}

export interface MindNodeBadge<T> {
  id: string;
  topic: string;
  x: number;
  y: number;
  value: T;
}

/**
 * Positions badges at the top-right corner of visible nodes for which
 * `select` returns a value.
 */
export function useMindNodeBadges<T>(
  board: PlaitBoard,
  select: (element: MindElement) => T | undefined
): MindNodeBadge<T>[] {
  const boardVersion = useContext(BoardContext)?.v;
  const [badges, setBadges] = useState<MindNodeBadge<T>[]>([]);
  const selectRef = useRef(select);
  selectRef.current = select;

  // react-board advances its version after Plait refreshes layout references.
  // A local draft render can see new children before those references exist.
  useEffect(() => {
    const host = PlaitBoard.getBoardContainer(board).closest('.drawnix');
    if (!host) return;
    const updatePositions = () => {
      if (FLUSHING.get(board)) return;
      const bounds = host.getBoundingClientRect();
      const result: MindNodeBadge<T>[] = [];
      findElements(board, {
        match: (element) => MindElement.isMindElement(board, element),
        recursion: (element) => !element.isCollapsed,
      }).forEach((element) => {
        const mindElement = element as MindElement;
        const value = selectRef.current(mindElement);
        if (value === undefined) return;
        const rect = getRectangleByElements(board, [mindElement], false);
        const hostPoint = toHostPointFromViewBoxPoint(board, [
          rect.x + rect.width,
          rect.y,
        ]);
        const [screenX, screenY] = toScreenPointFromHostPoint(
          board,
          hostPoint
        );
        result.push({
          id: mindElement.id,
          topic: Node.string(mindElement.data.topic),
          x: screenX - bounds.left + 5,
          y: screenY - bounds.top - 8,
          value,
        });
      });
      setBadges(result);
    };
    updatePositions();
    const observer = new ResizeObserver(updatePositions);
    observer.observe(host);
    return () => observer.disconnect();
  }, [board, boardVersion]);

  return badges;
}

export function hasNote(element: MindElement): boolean {
  return typeof element.note === 'string' && !!element.note;
}
