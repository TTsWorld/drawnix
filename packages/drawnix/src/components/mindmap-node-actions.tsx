// Entry points of node widgets (note, Anki cards) on the node itself: a row of
// round buttons on the bottom edge of the hovered or selected node, and a tiny
// dot on nodes that have content while they are at rest.
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  getSelectedElements,
  PlaitBoard,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import classNames from 'classnames';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { AnkiCardIcon, NoteIcon } from './icons';
import {
  MIND_WIDGET_OPENER_CLASS_NAME,
  type MindNodeRect,
  type MindWidget,
  openMindWidget,
  useMindNodeRects,
} from './mindmap-widgets';
import './mindmap-node-actions.scss';

/** Button diameter in screen pixels at zoom 1 and above (fixed, like the reference). */
export const NODE_ACTION_SIZE = 22;
/** Zoomed out, buttons shrink with the node down to this size. */
export const NODE_ACTION_MIN_SIZE = 18;
/** Smallest size buttons shrink to when a neighbour leaves too little room. */
export const NODE_ACTION_FIT_MIN_SIZE = 14;
const NODE_ACTION_COUNT = 2;
const NODE_ACTION_GAP = 4;
/**
 * At 100% the buttons cover this much of the node's edge: the border, not the
 * text (short nodes have about 5px of padding around the text). It scales
 * down with the node when zoomed out.
 */
export const NODE_ACTION_EDGE_OVERLAP = 4;
/** Room kept between the buttons and a neighbouring node. */
const NODE_ACTION_CLEARANCE = 2;
// Leaving the node for a gap next to the buttons must not drop them at once.
const HOVER_LEAVE_DELAY = 150;

export function getNodeActionSize(zoom: number) {
  return Math.round(
    Math.min(
      NODE_ACTION_SIZE,
      Math.max(NODE_ACTION_MIN_SIZE, NODE_ACTION_SIZE * zoom)
    )
  );
}

export function getNodeActionEdgeOverlap(zoom: number) {
  return NODE_ACTION_EDGE_OVERLAP * Math.min(1, zoom);
}

export interface NodeActionPlacement {
  /** Center of the row. */
  x: number;
  top: number;
  size: number;
  side: 'below' | 'above';
}

/**
 * Places a node's buttons centered on its bottom edge, as in the reference.
 * Sibling gaps shrink with zoom; when a neighbour leaves no room below, the
 * buttons go on the top edge, and if neither side has room they shrink to fit
 * the larger gap. Only when even the smallest size does not fit (far zoomed
 * out) do they stay below and cover the neighbour while shown.
 */
export function placeNodeActions(
  rect: MindNodeRect,
  rects: MindNodeRect[],
  size: number,
  overlap = NODE_ACTION_EDGE_OVERLAP
): NodeActionPlacement {
  const x = (rect.left + rect.right) / 2;
  const halfWidth =
    (NODE_ACTION_COUNT * size + (NODE_ACTION_COUNT - 1) * NODE_ACTION_GAP) / 2;
  let below = Infinity;
  let above = Infinity;
  for (const other of rects) {
    if (other.id === rect.id) continue;
    if (other.right <= x - halfWidth || other.left >= x + halfWidth) continue;
    if (other.top >= rect.bottom) below = Math.min(below, other.top - rect.bottom);
    else if (other.bottom <= rect.top)
      above = Math.min(above, rect.top - other.bottom);
  }
  // Height the row takes outside the node for a given size.
  const outside = (value: number) => value - overlap + NODE_ACTION_CLEARANCE;
  const place = (side: 'below' | 'above', value: number) => ({
    x,
    size: value,
    side,
    top:
      side === 'below'
        ? rect.bottom - overlap
        : rect.top + overlap - value,
  });
  if (outside(size) <= below) return place('below', size);
  if (outside(size) <= above) return place('above', size);
  const side = above > below ? 'above' : 'below';
  const room = Math.max(above, below);
  const fit = Math.floor(room + overlap - NODE_ACTION_CLEARANCE);
  return place(side, Math.max(NODE_ACTION_FIT_MIN_SIZE, Math.min(size, fit)));
}

/**
 * The node under a point, in editor coordinates. The buttons of the hovered
 * node stick out of one edge; that strip still counts as the node so the
 * pointer can move onto them.
 */
export function hitNodeRect(
  rects: MindNodeRect[],
  x: number,
  y: number,
  hovered: { id: string; top: number; bottom: number } | null
): string | null {
  // Nodes do not overlap in a laid-out map; the last match wins if they do.
  for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i];
    const own = hovered?.id === rect.id;
    const top = own ? Math.min(rect.top, hovered.top) : rect.top;
    const bottom = own ? Math.max(rect.bottom, hovered.bottom) : rect.bottom;
    if (x >= rect.left && x <= rect.right && y >= top && y <= bottom) {
      return rect.id;
    }
  }
  return null;
}

const isTextField = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('input, textarea, select, [contenteditable="true"]');

export const MindmapNodeActions = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const rects = useMindNodeRects(board);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Hide while the pointer is held on the board: dragging, moving, selecting.
  const [pressing, setPressing] = useState(false);
  const bars = useRef(new Map<string, HTMLElement>());
  const latest = useRef({
    rects,
    hoveredId,
    size: NODE_ACTION_SIZE,
    overlap: NODE_ACTION_EDGE_OVERLAP,
  });

  const readonly = PlaitBoard.isReadonly(board);
  const zoom = board.viewport?.zoom ?? 1;
  const size = getNodeActionSize(zoom);
  const overlap = getNodeActionEdgeOverlap(zoom);
  latest.current = { rects, hoveredId, size, overlap };

  const selected = getSelectedElements(board);
  const selectedId =
    selected.length === 1 &&
    MindElement.isMindElement(board, selected[0]) &&
    !PlaitBoard.hasBeenTextEditing(board)
      ? selected[0].id
      : null;
  const openWidget: MindWidget | null = appState.openNoteId
    ? 'note'
    : appState.openAnkiCardsId
    ? 'ankiCards'
    : null;
  const openId = appState.openNoteId ?? appState.openAnkiCardsId ?? null;

  useEffect(() => {
    if (readonly) return;
    const container = PlaitBoard.getBoardContainer(board);
    const host = container.closest<HTMLElement>('.drawnix');
    if (!host) return;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const inBar = (target: EventTarget | null) =>
      target instanceof Node &&
      [...bars.current.values()].some((bar) => bar.contains(target));
    const setHovered = (id: string | null) => {
      clearTimeout(leaveTimer);
      if (id || !latest.current.hoveredId) {
        setHoveredId(id);
        return;
      }
      leaveTimer = setTimeout(() => setHoveredId(null), HOVER_LEAVE_DELAY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (inBar(event.target)) {
        clearTimeout(leaveTimer);
        return;
      }
      // Panels and toolbars cover the board; only the board itself hovers nodes.
      if (!(event.target instanceof Node) || !container.contains(event.target)) {
        setHovered(null);
        return;
      }
      const bounds = host.getBoundingClientRect();
      const { rects, hoveredId, size, overlap } = latest.current;
      const hoveredRect = rects.find((rect) => rect.id === hoveredId);
      const placement =
        hoveredRect && placeNodeActions(hoveredRect, rects, size, overlap);
      setHovered(
        hitNodeRect(
          rects,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          hoveredRect && placement
            ? {
                id: hoveredRect.id,
                top: placement.top,
                bottom: placement.top + placement.size,
              }
            : null
        )
      );
    };
    const onPointerLeave = () => setHovered(null);
    const onPointerDown = (event: PointerEvent) => {
      if (!inBar(event.target)) setPressing(true);
    };
    const onPointerUp = () => setPressing(false);
    // Alt+Enter moves focus to the selected node's buttons: Plait inserts a
    // child node on Tab, so they cannot be in the board's Tab order.
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        isTextField(event.target)
      ) {
        return;
      }
      const elements = getSelectedElements(board);
      if (
        elements.length !== 1 ||
        !MindElement.isMindElement(board, elements[0]) ||
        PlaitBoard.hasBeenTextEditing(board)
      ) {
        return;
      }
      const button = bars.current
        .get(elements[0].id)
        ?.querySelector<HTMLElement>('button');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      button.focus();
    };
    host.addEventListener('pointermove', onPointerMove, true);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      clearTimeout(leaveTimer);
      host.removeEventListener('pointermove', onPointerMove, true);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [board, readonly]);

  // The open panel's node keeps its buttons so a second press closes it.
  const active = new Set<string>();
  if (!readonly) {
    if (openId) active.add(openId);
    if (!pressing) {
      if (selectedId) active.add(selectedId);
      if (hoveredId) active.add(hoveredId);
    }
  }

  const toggle = (widget: MindWidget, id: string) => {
    const isOpen = openWidget === widget && openId === id;
    openMindWidget(setAppState, isOpen ? null : widget, id);
  };

  const onBarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Plait handles keys on the document; Tab or Delete would edit the map.
    event.stopPropagation();
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('button')
    );
    const index = buttons.indexOf(event.target as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === 'ArrowRight') move(index + 1);
    else if (event.key === 'ArrowLeft') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      PlaitBoard.getBoardContainer(board)
        .closest<HTMLElement>('.drawnix')
        ?.focus({ preventScroll: true });
    }
  };

  return (
    <div className="drawnix-node-actions-layer">
      {rects.map((rect) => {
        if (active.has(rect.id)) {
          const placement = placeNodeActions(rect, rects, size, overlap);
          const noteOpen = openWidget === 'note' && openId === rect.id;
          const cardsOpen = openWidget === 'ankiCards' && openId === rect.id;
          const noteLabel = t(rect.hasNote ? 'notes.open' : 'notes.add');
          const cardsLabel = rect.cardCount
            ? `${t('anki.open')} (${rect.cardCount})`
            : t('anki.add');
          return (
            <div
              key={rect.id}
              ref={(element) => {
                if (element) bars.current.set(rect.id, element);
                else bars.current.delete(rect.id);
              }}
              role="toolbar"
              aria-label={`${t('nodeActions.label')}: ${rect.topic}`}
              className={classNames(
                'drawnix-node-actions',
                ATTACHED_ELEMENT_CLASS_NAME
              )}
              data-node-id={rect.id}
              data-side={placement.side}
              style={
                {
                  left: placement.x,
                  top: placement.top,
                  '--drawnix-node-action-size': `${placement.size}px`,
                } as React.CSSProperties
              }
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={onBarKeyDown}
            >
              <button
                type="button"
                className={classNames(
                  'drawnix-node-action',
                  MIND_WIDGET_OPENER_CLASS_NAME,
                  {
                    'drawnix-node-action--filled': rect.hasNote,
                    'drawnix-node-action--open': noteOpen,
                  }
                )}
                data-widget="note"
                aria-label={noteLabel}
                title={noteLabel}
                aria-expanded={noteOpen}
                onClick={() => toggle('note', rect.id)}
              >
                {NoteIcon}
              </button>
              <button
                type="button"
                className={classNames(
                  'drawnix-node-action',
                  MIND_WIDGET_OPENER_CLASS_NAME,
                  {
                    'drawnix-node-action--filled': rect.cardCount > 0,
                    'drawnix-node-action--open': cardsOpen,
                  }
                )}
                data-widget="ankiCards"
                aria-label={cardsLabel}
                title={cardsLabel}
                aria-expanded={cardsOpen}
                tabIndex={-1}
                onClick={() => toggle('ankiCards', rect.id)}
              >
                {AnkiCardIcon}
                {rect.cardCount > 0 && (
                  <span className="drawnix-node-action__count" aria-hidden="true">
                    {rect.cardCount > 99 ? '99+' : rect.cardCount}
                  </span>
                )}
              </button>
            </div>
          );
        }
        if (!rect.hasNote && !rect.cardCount) return null;
        // A hint only; the buttons carry the state for assistive technology.
        return (
          <span
            key={rect.id}
            className="drawnix-node-content-dot"
            data-node-id={rect.id}
            aria-hidden="true"
            style={{ left: rect.right, top: rect.top }}
          />
        );
      })}
    </div>
  );
};
