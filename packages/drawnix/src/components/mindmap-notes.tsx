import { useEffect, useRef, useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  findElements,
  getRectangleByElements,
  getSelectedElements,
  PlaitBoard,
  RectangleClient,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import { Node } from 'slate';
import { applyMindmapOperations } from '../editor';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { NoteIcon } from './icons';
import { ToolButton } from './tool-button';
import './mindmap-notes.scss';

export const MindmapNoteButton = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { setAppState } = useDrawnix();
  const selected = getSelectedElements(board);
  if (selected.length !== 1 || !MindElement.isMindElement(board, selected[0]))
    return null;
  const node = selected[0];
  return (
    <ToolButton
      type="button"
      className="property-button"
      visible
      icon={NoteIcon}
      title={t(node.note ? 'notes.open' : 'notes.add')}
      aria-label={t(node.note ? 'notes.open' : 'notes.add')}
      onClick={() =>
        setAppState((state) => ({ ...state, openNoteId: node.id }))
      }
    />
  );
};

export const MindmapNotes = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [badges, setBadges] = useState<
    Array<{ id: string; topic: string; x: number; y: number }>
  >([]);
  const node = findElements(board, {
    match: (element) =>
      element.id === appState.openNoteId &&
      MindElement.isMindElement(board, element),
    recursion: () => true,
  })[0] as MindElement | undefined;

  useEffect(() => {
    if (node) textarea.current?.focus();
    else if (appState.openNoteId)
      setAppState((state) => ({ ...state, openNoteId: null }));
  }, [node?.id, appState.openNoteId, setAppState]);

  useEffect(() => {
    const host = PlaitBoard.getBoardContainer(board).closest('.drawnix');
    if (!host) return;
    const updatePositions = () => {
      const bounds = host.getBoundingClientRect();
      const nodes = findElements(board, {
        match: (element) =>
          MindElement.isMindElement(board, element) &&
          typeof element.note === 'string' &&
          !!element.note,
        recursion: (element) => !element.isCollapsed,
      }) as MindElement[];
      setBadges(
        nodes.map((element) => {
          const rect = getRectangleByElements(board, [element], false);
          const [, end] = RectangleClient.getPoints(rect);
          const point = toScreenPointFromHostPoint(
            board,
            toHostPointFromViewBoxPoint(board, [end[0], rect.y])
          );
          return {
            id: element.id,
            topic: Node.string(element.data.topic),
            x: point[0] - bounds.left + 5,
            y: point[1] - bounds.top - 8,
          };
        })
      );
    };
    updatePositions();
    const observer = new ResizeObserver(updatePositions);
    observer.observe(host);
    return () => observer.disconnect();
  }, [board, board.children, board.viewport]);

  const close = () => {
    setAppState((state) => ({ ...state, openNoteId: null }));
    const host =
      PlaitBoard.getBoardContainer(board).closest<HTMLElement>('.drawnix');
    host?.focus({ preventScroll: true });
  };

  return (
    <>
      <div className="drawnix-note-badges">
        {badges.map((badge) => (
          <button
            key={badge.id}
            type="button"
            className={`drawnix-note-badge ${ATTACHED_ELEMENT_CLASS_NAME}`}
            style={{ left: badge.x, top: badge.y }}
            data-note-node-id={badge.id}
            title={`${t('notes.open')}: ${badge.topic}`}
            aria-label={`${t('notes.open')}: ${badge.topic}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              setAppState((state) => ({ ...state, openNoteId: badge.id }))
            }
          >
            {NoteIcon}
          </button>
        ))}
      </div>
      {node && (
        <aside
          className={`drawnix-note-panel ${ATTACHED_ELEMENT_CLASS_NAME}`}
          aria-label={t('notes.title')}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 'z'
            ) {
              event.preventDefault();
              if (event.shiftKey) board.redo();
              else board.undo();
            }
          }}
        >
          <header>
            <div>
              <span>{t('notes.title')}</span>
              <h2>{Node.string(node.data.topic)}</h2>
            </div>
            <button
              type="button"
              aria-label={t('notes.close')}
              title={t('notes.close')}
              onClick={close}
            >
              ×
            </button>
          </header>
          <label
            className="drawnix-note-label"
            htmlFor={`drawnix-note-${node.id}`}
          >
            {t('notes.content')}
          </label>
          <textarea
            ref={textarea}
            id={`drawnix-note-${node.id}`}
            value={typeof node.note === 'string' ? node.note : ''}
            placeholder={t('notes.placeholder')}
            onChange={(event) =>
              applyMindmapOperations(board, [
                { type: 'set_note', nodeId: node.id, note: event.target.value },
              ])
            }
          />
          <footer>
            <span>{t('notes.hint')}</span>
            <button
              type="button"
              disabled={!node.note}
              onClick={() =>
                applyMindmapOperations(board, [
                  { type: 'set_note', nodeId: node.id, note: '' },
                ])
              }
            >
              {t('notes.remove')}
            </button>
          </footer>
        </aside>
      )}
    </>
  );
};
