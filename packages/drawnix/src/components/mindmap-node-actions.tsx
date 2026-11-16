// Entry points of node widgets (note, Anki cards) on the node itself: a row of
// round buttons on the bottom edge of the hovered or selected node, and a tiny
// dot on nodes that have content while they are at rest.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  getSelectedElements,
  PlaitBoard,
  PlaitPointerType,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import classNames from 'classnames';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { AnkiCardIcon, NoteIcon } from './icons';
import {
  getAccentTextColor,
  getCanvasColor,
  isDarkCanvas,
} from './mindmap-node-accent';
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
export const NODE_ACTION_GAP = 6;
/**
 * Each button takes presses this far past its edge (28px on a 22px button);
 * it also covers the 2px canvas-colored ring around the button.
 */
export const NODE_ACTION_HIT_PAD = 3;
/** Room kept between the press area and a neighbouring node. */
const NODE_ACTION_CLEARANCE = 2;
// Leaving the node for a gap next to the buttons must not drop them at once.
const HOVER_LEAVE_DELAY = 150;
/** Fade-out of buttons that are no longer shown; matches the stylesheet. */
export const NODE_ACTION_EXIT_DURATION = 120;

export function getNodeActionSize(zoom: number) {
  return Math.round(
    Math.min(
      NODE_ACTION_SIZE,
      Math.max(NODE_ACTION_MIN_SIZE, NODE_ACTION_SIZE * zoom)
    )
  );
}

export interface NodeActionPlacement {
  /** Center of the row: the middle of the node's width. */
  x: number;
  /** Center of the row: on the bottom (or top) border of the node. */
  y: number;
  size: number;
  side: 'below' | 'above';
}

/** Room kept between the buttons and the node's text inside the node. */
const NODE_ACTION_TEXT_CLEARANCE = 1;

/**
 * Places a node's buttons centered on its bottom border, half inside the
 * node, as in the reference. Small nodes have less than half a button of room
 * under their text; there the buttons go only as far into the node as the
 * text allows, so the border still crosses them but the text stays readable.
 *
 * Sibling gaps shrink with zoom; when a neighbour leaves no room below, the
 * buttons go on the top border, and if neither side has room they shrink to
 * fit the larger gap. Only when even the smallest size does not fit (far
 * zoomed out) do they stay below and cover the neighbour while shown.
 */
export function placeNodeActions(
  rect: MindNodeRect,
  rects: MindNodeRect[],
  size: number
): NodeActionPlacement {
  const x = (rect.left + rect.right) / 2;
  const halfWidth =
    (NODE_ACTION_COUNT * size + (NODE_ACTION_COUNT - 1) * NODE_ACTION_GAP) /
      2 +
    NODE_ACTION_HIT_PAD;
  let below = Infinity;
  let above = Infinity;
  for (const other of rects) {
    if (other.id === rect.id) continue;
    if (other.right <= x - halfWidth || other.left >= x + halfWidth) continue;
    if (other.top >= rect.bottom) below = Math.min(below, other.top - rect.bottom);
    else if (other.bottom <= rect.top)
      above = Math.min(above, rect.top - other.bottom);
  }
  const inside = {
    below: rect.bottom - rect.contentBottom - NODE_ACTION_TEXT_CLEARANCE,
    above: rect.contentTop - rect.top - NODE_ACTION_TEXT_CLEARANCE,
  };
  // How far a row of this size goes into the node, at most half of it.
  const overlap = (side: 'below' | 'above', value: number) =>
    Math.max(0, Math.min(value / 2, inside[side]));
  // Height the row takes outside the node, press areas and clearance included.
  const outside = (side: 'below' | 'above', value: number) =>
    value - overlap(side, value) + NODE_ACTION_HIT_PAD + NODE_ACTION_CLEARANCE;
  const place = (side: 'below' | 'above', value: number) => {
    const offset = value / 2 - overlap(side, value);
    return {
      x,
      y: side === 'below' ? rect.bottom + offset : rect.top - offset,
      size: value,
      side,
    };
  };
  if (outside('below', size) <= below) return place('below', size);
  if (outside('above', size) <= above) return place('above', size);
  const side = above > below ? 'above' : 'below';
  const room = side === 'above' ? above : below;
  let fit = size;
  while (fit > NODE_ACTION_FIT_MIN_SIZE && outside(side, fit) > room) fit--;
  return place(side, fit);
}

/** Vertical strip a placed row takes presses in, press areas included. */
export function getNodeActionStrip(placement: NodeActionPlacement) {
  const half = placement.size / 2 + NODE_ACTION_HIT_PAD;
  return { top: placement.y - half, bottom: placement.y + half };
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

/**
 * Buttons belong to the selection tool: with a pen, shape or hand tool they
 * would catch the press that starts a stroke or a pan.
 */
const isSelecting = (board: PlaitBoard) =>
  PlaitBoard.isPointer(board, PlaitPointerType.selection);

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
  const latest = useRef({ rects, hoveredId, size: NODE_ACTION_SIZE });
  // Buttons that were just hidden fade out from their last place.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const shown = useRef<ReadonlySet<string>>(new Set());
  const leaveTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const readonly = PlaitBoard.isReadonly(board);
  // The tool switch updates app state, which renders this again.
  const selecting = isSelecting(board);
  const zoom = board.viewport?.zoom ?? 1;
  const size = getNodeActionSize(zoom);
  latest.current = { rects, hoveredId, size };
  const canvas = getCanvasColor(board);

  const selected = getSelectedElements(board);
  // Typing in a node: its buttons would hang over the growing text.
  const editing = PlaitBoard.hasBeenTextEditing(board);
  const selectedId =
    selected.length === 1 && MindElement.isMindElement(board, selected[0])
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
    const cancelLeave = () => {
      clearTimeout(leaveTimer);
      leaveTimer = undefined;
    };
    const inBar = (target: EventTarget | null) =>
      target instanceof Node &&
      [...bars.current.values()].some((bar) => bar.contains(target));
    const setHovered = (id: string | null) => {
      if (id || !latest.current.hoveredId) {
        cancelLeave();
        setHoveredId(id);
        return;
      }
      // Further moves outside must not push the timer back.
      if (leaveTimer !== undefined) return;
      leaveTimer = setTimeout(() => {
        leaveTimer = undefined;
        setHoveredId(null);
      }, HOVER_LEAVE_DELAY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!isSelecting(board)) {
        cancelLeave();
        setHoveredId(null);
        return;
      }
      if (inBar(event.target)) {
        cancelLeave();
        return;
      }
      // Panels and toolbars cover the board; only the board itself hovers nodes.
      if (!(event.target instanceof Node) || !container.contains(event.target)) {
        setHovered(null);
        return;
      }
      const bounds = host.getBoundingClientRect();
      const { rects, hoveredId, size } = latest.current;
      const hoveredRect = rects.find((rect) => rect.id === hoveredId);
      setHovered(
        hitNodeRect(
          rects,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          hoveredRect
            ? {
                id: hoveredRect.id,
                ...getNodeActionStrip(
                  placeNodeActions(hoveredRect, rects, size)
                ),
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
      cancelLeave();
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
  if (!readonly && selecting) {
    if (openId) active.add(openId);
    if (!pressing && !editing) {
      if (selectedId) active.add(selectedId);
      if (hoveredId) active.add(hoveredId);
    }
  }

  const activeKey = [...active].sort().join(' ');
  useLayoutEffect(() => {
    const gone = [...shown.current].filter((id) => !active.has(id));
    shown.current = new Set(active);
    setLeaving((current) => {
      const next = new Set([...current, ...gone]);
      active.forEach((id) => next.delete(id));
      return next.size === current.size &&
        [...next].every((id) => current.has(id))
        ? current
        : next;
    });
    if (!gone.length) return;
    const timer = setTimeout(() => {
      leaveTimers.current.delete(timer);
      setLeaving((current) => {
        const next = new Set(current);
        gone.forEach((id) => next.delete(id));
        return next;
      });
    }, NODE_ACTION_EXIT_DURATION);
    leaveTimers.current.add(timer);
    // `active` is derived from the values in activeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const toggle = (widget: MindWidget, id: string) => {
    const isOpen = openWidget === widget && openId === id;
    openMindWidget(setAppState, isOpen ? null : widget, id);
  };

  const onBarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Plait handles keys on the document: Tab, Delete or typing would edit
    // the map. Undo and redo still apply to the board, as in the panels.
    event.stopPropagation();
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'z' &&
      !event.altKey
    ) {
      event.preventDefault();
      if (event.shiftKey) board.redo();
      else board.undo();
      return;
    }
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

  const renderBar = (rect: MindNodeRect, ghost: boolean) => {
    const placement = placeNodeActions(rect, rects, size);
    const noteOpen = !ghost && openWidget === 'note' && openId === rect.id;
    const cardsOpen = !ghost && openWidget === 'ankiCards' && openId === rect.id;
    const noteLabel = t(rect.hasNote ? 'notes.open' : 'notes.add');
    const cardsLabel = rect.cardCount
      ? `${t('anki.open')} (${rect.cardCount})`
      : t('anki.add');
    const style = {
      left: placement.x,
      top: placement.y,
      '--drawnix-node-action-size': `${placement.size}px`,
      '--drawnix-node-action-scale': placement.size / NODE_ACTION_SIZE,
      '--drawnix-node-accent': rect.accent,
      '--drawnix-node-accent-text': getAccentTextColor(rect.accent),
    } as React.CSSProperties;
    const count = rect.cardCount > 0 && (
      <span className="drawnix-node-action__count" aria-hidden="true">
        {rect.cardCount > 99 ? '99+' : rect.cardCount}
      </span>
    );
    const buttonClass = (filled: boolean, open: boolean) =>
      classNames('drawnix-node-action', {
        [MIND_WIDGET_OPENER_CLASS_NAME]: !ghost,
        'drawnix-node-action--filled': filled,
        'drawnix-node-action--open': open,
      });
    if (ghost) {
      // A picture of the buttons fading out: not focusable, not pressable.
      return (
        <div
          key={rect.id}
          className={classNames(
            'drawnix-node-actions',
            'drawnix-node-actions--leaving',
            ATTACHED_ELEMENT_CLASS_NAME
          )}
          data-leaving-node-id={rect.id}
          data-side={placement.side}
          aria-hidden="true"
          style={style}
        >
          <span className={buttonClass(rect.hasNote, false)}>{NoteIcon}</span>
          <span className={buttonClass(rect.cardCount > 0, false)}>
            {AnkiCardIcon}
            {count}
          </span>
        </div>
      );
    }
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
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onBarKeyDown}
      >
        <button
          type="button"
          className={buttonClass(rect.hasNote, noteOpen)}
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
          className={buttonClass(rect.cardCount > 0, cardsOpen)}
          data-widget="ankiCards"
          aria-label={cardsLabel}
          title={cardsLabel}
          aria-expanded={cardsOpen}
          tabIndex={-1}
          onClick={() => toggle('ankiCards', rect.id)}
        >
          {AnkiCardIcon}
          {count}
        </button>
      </div>
    );
  };

  return (
    <div
      className="drawnix-node-actions-layer"
      data-canvas={isDarkCanvas(canvas) ? 'dark' : 'light'}
      style={{ '--drawnix-canvas': canvas } as React.CSSProperties}
    >
      {rects.map((rect) => {
        if (active.has(rect.id)) return renderBar(rect, false);
        if (leaving.has(rect.id)) return renderBar(rect, true);
        if (!rect.hasNote && !rect.cardCount) return null;
        // The pointer or selection is on the node: its buttons speak for it,
        // or will once the drag or text edit ends.
        if (
          !readonly &&
          selecting &&
          (rect.id === selectedId || rect.id === hoveredId)
        ) {
          return null;
        }
        // A hint only; the buttons carry the state for assistive technology.
        return (
          <span
            key={rect.id}
            className="drawnix-node-content-dot"
            data-node-id={rect.id}
            aria-hidden="true"
            style={
              {
                left: rect.right,
                top: rect.top,
                '--drawnix-node-accent': rect.accent,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
};
