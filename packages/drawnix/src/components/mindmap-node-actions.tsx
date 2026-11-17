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
import { type DrawnixState, useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { AnkiCardIcon, NoteIcon } from './icons';
import { getCanvasColor, isDarkCanvas } from './mindmap-node-accent';
import {
  MIND_WIDGET_OPENER_CLASS_NAME,
  type MindNodeRect,
  type MindWidget,
  openMindWidget,
  useMindNodeRects,
} from './mindmap-widgets';
import './mindmap-node-actions.scss';

// The buttons are a secondary way into a node; its text is the content. So
// they are sized from the node's text on screen, never larger than one
// character of it, and grow and shrink with zoom and font size.
/**
 * Button diameter, as a share of the node's font size: one character, as
 * tall as the text and no taller.
 */
export const NODE_ACTION_SIZE_RATIO = 1;
/**
 * Icon size, as a share of the button (so of the font size too): large
 * enough at 100% (10.5px on 14px text) to tell the two icons apart.
 */
export const NODE_ACTION_ICON_RATIO = 0.75;
/** Space between the two buttons, as a share of the button diameter. */
export const NODE_ACTION_GAP_RATIO = 0.25;
/** Below this diameter an icon is unreadable: the buttons show as plain dots. */
export const NODE_ACTION_ICON_MIN_SIZE = 9;
/** Smallest diameter buttons shrink to when a neighbour leaves too little room. */
export const NODE_ACTION_FIT_MIN_SIZE = 6;
/** Each button takes presses in a square of this size, where there is room. */
export const NODE_ACTION_HIT_SIZE = 24;
/** The canvas-colored ring that cuts the node's border around each button. */
const NODE_ACTION_RING = 1;
/** Room kept between the buttons (or their press areas) and a neighbour. */
const NODE_ACTION_CLEARANCE = 2;
/** Room kept between the buttons and the node's text inside the node. */
const NODE_ACTION_TEXT_CLEARANCE = 1;
// Leaving the node for a gap next to the buttons must not drop them at once.
const HOVER_LEAVE_DELAY = 150;
/** Fade-out of buttons that are no longer shown; matches the stylesheet. */
export const NODE_ACTION_EXIT_DURATION = 120;

/** Diameter for a node whose text is `fontSize` screen pixels: never larger. */
export function getNodeActionSize(fontSize: number) {
  return Math.max(1, Math.floor(fontSize * NODE_ACTION_SIZE_RATIO));
}

export function getNodeActionGap(size: number) {
  return Math.max(2, Math.round(size * NODE_ACTION_GAP_RATIO));
}

/**
 * How far the press area of each button reaches past the circle. Across, it
 * grows outwards only, so the two buttons meet in the middle of the gap and
 * never take each other's presses.
 */
function getOuterHitPad(size: number, gap: number) {
  return Math.max(0, NODE_ACTION_HIT_SIZE - size - gap / 2);
}

export interface NodeActionPlacement {
  /** Center of the row: the middle of the node's width. */
  x: number;
  /** Center of the row: on the bottom (or top) border of the node. */
  y: number;
  size: number;
  gap: number;
  side: 'below' | 'above';
  /** Press area past the circle above, below and on the outer sides. */
  hit: { top: number; bottom: number; outer: number };
}

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
 *
 * Press areas fill up to 24px where they reach neither the node's text nor a
 * neighbour; next to them they are smaller.
 */
export function placeNodeActions(
  rect: MindNodeRect,
  rects: MindNodeRect[],
  size = getNodeActionSize(rect.fontSize)
): NodeActionPlacement {
  const x = (rect.left + rect.right) / 2;
  const startGap = getNodeActionGap(size);
  const halfWidth =
    size +
    startGap / 2 +
    Math.max(getOuterHitPad(size, startGap), NODE_ACTION_RING);
  let below = Infinity;
  let above = Infinity;
  for (const other of rects) {
    if (other.id === rect.id) continue;
    if (other.right <= x - halfWidth || other.left >= x + halfWidth) continue;
    if (other.top >= rect.bottom)
      below = Math.min(below, other.top - rect.bottom);
    else if (other.bottom <= rect.top)
      above = Math.min(above, rect.top - other.bottom);
  }
  const room = { below, above };
  const inside = {
    below: rect.bottom - rect.contentBottom - NODE_ACTION_TEXT_CLEARANCE,
    above: rect.contentTop - rect.top - NODE_ACTION_TEXT_CLEARANCE,
  };
  type Side = 'below' | 'above';
  // How far a row of this size goes into the node, at most half of it.
  const overlap = (side: Side, value: number) =>
    Math.max(0, Math.min(value / 2, inside[side]));
  // Height the visible row takes outside the node: ring and clearance.
  const outside = (side: Side, value: number) =>
    value - overlap(side, value) + NODE_ACTION_RING + NODE_ACTION_CLEARANCE;
  const place = (side: Side, value: number): NodeActionPlacement => {
    const into = overlap(side, value);
    const offset = value / 2 - into;
    const gap = getNodeActionGap(value);
    // Up to 24px tall: toward the text only to its clearance, outward only
    // to the neighbour's clearance; what one side lacks the other may take.
    const extra = Math.max(0, NODE_ACTION_HIT_SIZE - value);
    const maxIn = Math.max(0, inside[side] - into);
    const maxOut = Math.max(
      0,
      room[side] - (value - into) - NODE_ACTION_CLEARANCE
    );
    let hitIn = Math.min(maxIn, extra / 2);
    const hitOut = Math.min(maxOut, extra - hitIn);
    hitIn = Math.min(maxIn, extra - hitOut);
    return {
      x,
      y: side === 'below' ? rect.bottom + offset : rect.top - offset,
      size: value,
      gap,
      side,
      hit: {
        top: side === 'below' ? hitIn : hitOut,
        bottom: side === 'below' ? hitOut : hitIn,
        outer: getOuterHitPad(value, gap),
      },
    };
  };
  if (outside('below', size) <= below) return place('below', size);
  if (outside('above', size) <= above) return place('above', size);
  const side: Side = above > below ? 'above' : 'below';
  const smallest = Math.min(size, NODE_ACTION_FIT_MIN_SIZE);
  let fit = size;
  while (fit > smallest && outside(side, fit) > room[side]) fit--;
  return place(side, fit);
}

/** Vertical strip a placed row takes presses in, press areas included. */
export function getNodeActionStrip(placement: NodeActionPlacement) {
  const half = placement.size / 2;
  return {
    top: placement.y - half - placement.hit.top,
    bottom: placement.y + half + placement.hit.bottom,
  };
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

const getHost = (board: PlaitBoard) =>
  PlaitBoard.getBoardContainer(board).closest<HTMLElement>('.drawnix');

const isSameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

function getOpenWidget(appState: DrawnixState): MindWidget | null {
  if (appState.openNoteId) return 'note';
  if (appState.openAnkiCardsId) return 'ankiCards';
  return null;
}

type ContentStatusKey =
  | 'nodeActions.hasNoteAndCards'
  | 'nodeActions.hasNote'
  | 'nodeActions.hasCards';

function getContentStatusKey(rect: MindNodeRect): ContentStatusKey | null {
  if (rect.hasNote && rect.hasCards) return 'nodeActions.hasNoteAndCards';
  if (rect.hasNote) return 'nodeActions.hasNote';
  if (rect.hasCards) return 'nodeActions.hasCards';
  return null;
}

export const MindmapNodeActions = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const rects = useMindNodeRects(board);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Roving tab stop: the button that last had focus is the one Tab reaches.
  const [tabStop, setTabStop] = useState<MindWidget>('note');
  // Hide while the pointer is held on the board: dragging, moving, selecting.
  const [pressing, setPressing] = useState(false);
  const bars = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ rects, hoveredId });
  // Buttons that were just hidden fade out from their last place.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const shown = useRef<ReadonlySet<string>>(new Set());
  const leaveTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const readonly = PlaitBoard.isReadonly(board);
  // The tool switch updates app state, which renders this again.
  const selecting = isSelecting(board);
  latest.current = { rects, hoveredId };
  const canvas = getCanvasColor(board);

  const selected = getSelectedElements(board);
  // Typing in a node: its buttons would hang over the growing text.
  const editing = PlaitBoard.hasBeenTextEditing(board);
  const selectedId =
    selected.length === 1 && MindElement.isMindElement(board, selected[0])
      ? selected[0].id
      : null;
  const openWidget = getOpenWidget(appState);
  const openId = appState.openNoteId ?? appState.openAnkiCardsId ?? null;
  const isOpen = (widget: MindWidget, id: string) =>
    openWidget === widget && openId === id;

  useEffect(() => {
    if (readonly) return;
    const container = PlaitBoard.getBoardContainer(board);
    const host = getHost(board);
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
      if (
        !(event.target instanceof Node) ||
        !container.contains(event.target)
      ) {
        setHovered(null);
        return;
      }
      const bounds = host.getBoundingClientRect();
      const { rects, hoveredId } = latest.current;
      const hoveredRect = rects.find((rect) => rect.id === hoveredId);
      setHovered(
        hitNodeRect(
          rects,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          hoveredRect
            ? {
                id: hoveredRect.id,
                ...getNodeActionStrip(placeNodeActions(hoveredRect, rects)),
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
      // Keep the same set when nothing changed, so React skips the render.
      return isSameSet(next, current) ? current : next;
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
    openMindWidget(setAppState, isOpen(widget, id) ? null : widget, id);
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
      getHost(board)?.focus({ preventScroll: true });
    }
  };

  const renderBar = (rect: MindNodeRect, ghost: boolean) => {
    const placement = placeNodeActions(rect, rects);
    const iconsShown = placement.size >= NODE_ACTION_ICON_MIN_SIZE;
    const actions = [
      {
        widget: 'note' as const,
        icon: NoteIcon,
        filled: rect.hasNote,
        label: t(rect.hasNote ? 'notes.open' : 'notes.add'),
      },
      {
        widget: 'ankiCards' as const,
        icon: AnkiCardIcon,
        filled: rect.hasCards,
        // No count, here or on the button: the fill says whether there are cards.
        label: t(rect.hasCards ? 'anki.open' : 'anki.add'),
      },
    ];
    const style = {
      left: placement.x,
      top: placement.y,
      '--drawnix-node-action-size': `${placement.size}px`,
      '--drawnix-node-action-gap': `${placement.gap}px`,
      '--drawnix-node-action-icon': `${
        placement.size * NODE_ACTION_ICON_RATIO
      }px`,
      '--drawnix-node-action-hit-top': `${placement.hit.top}px`,
      '--drawnix-node-action-hit-bottom': `${placement.hit.bottom}px`,
      '--drawnix-node-action-hit-outer': `${placement.hit.outer}px`,
      '--drawnix-node-accent': rect.accent,
    } as React.CSSProperties;
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
          data-icons={iconsShown ? 'shown' : 'hidden'}
          aria-hidden="true"
          style={style}
        >
          {actions.map(({ widget, icon, filled }) => (
            <span key={widget} className={buttonClass(filled, false)}>
              {icon}
            </span>
          ))}
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
        data-icons={iconsShown ? 'shown' : 'hidden'}
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onBarKeyDown}
      >
        {actions.map(({ widget, icon, filled, label }) => {
          const open = isOpen(widget, rect.id);
          return (
            <button
              key={widget}
              type="button"
              className={buttonClass(filled, open)}
              data-widget={widget}
              aria-label={label}
              title={label}
              aria-expanded={open}
              tabIndex={tabStop === widget ? 0 : -1}
              onFocus={() => setTabStop(widget)}
              onClick={() => toggle(widget, rect.id)}
            >
              {icon}
            </button>
          );
        })}
      </div>
    );
  };

  // The dots are pictures only; announce what the selected node holds.
  const selectedRect = rects.find((rect) => rect.id === selectedId);
  const contentKey = selectedRect ? getContentStatusKey(selectedRect) : null;
  const contentStatus =
    contentKey && selectedRect
      ? t(contentKey).replace('{topic}', selectedRect.topic)
      : '';

  return (
    <div
      className="drawnix-node-actions-layer"
      data-canvas={isDarkCanvas(canvas) ? 'dark' : 'light'}
      style={{ '--drawnix-canvas': canvas } as React.CSSProperties}
    >
      <span className="drawnix-node-content-status" aria-live="polite">
        {contentStatus}
      </span>
      {rects.map((rect) => {
        if (active.has(rect.id)) return renderBar(rect, false);
        if (leaving.has(rect.id)) return renderBar(rect, true);
        if (!rect.hasNote && !rect.hasCards) return null;
        // The pointer or selection is on the node: its buttons speak for it,
        // or will once the drag or text edit ends.
        if (
          !readonly &&
          selecting &&
          (rect.id === selectedId || rect.id === hoveredId)
        ) {
          return null;
        }
        // A hint only; the buttons and the status above carry the state for
        // assistive technology.
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
