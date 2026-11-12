import { useEffect, useRef, useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  getSelectedElements,
  type PlaitOperation,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { NoteIcon } from './icons';
import { ToolButton } from './tool-button';
import {
  closeMindWidgetPanel,
  findMindElement,
  getMindWidgetPanelProps,
  hasNote,
  openMindWidget,
  setNodeFromInput,
  useMindNodeBadges,
} from './mindmap-widgets';
import './mindmap-notes.scss';

export const MindmapNoteButton = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { setAppState } = useDrawnix();
  const selected = getSelectedElements(board);
  if (selected.length !== 1 || !MindElement.isMindElement(board, selected[0])) {
    return null;
  }
  const node = selected[0];
  const label = t(node.note ? 'notes.open' : 'notes.add');
  return (
    <ToolButton
      type="button"
      className="property-button"
      visible
      icon={NoteIcon}
      title={label}
      aria-label={label}
      onClick={() => openMindWidget(setAppState, 'note', node.id)}
    />
  );
};

export const MindmapNotes = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastInputOperation = useRef<PlaitOperation | null>(null);
  const badges = useMindNodeBadges(board, (element) =>
    hasNote(element) ? true : undefined
  );
  const node = findMindElement(board, appState.openNoteId);
  const note = typeof node?.note === 'string' ? node.note : '';
  const [draft, setDraft] = useState(note);

  useEffect(() => {
    setDraft(note);
  }, [node?.id, note]);

  useEffect(() => {
    lastInputOperation.current = null;
    if (node) textarea.current?.focus();
    else if (appState.openNoteId)
      setAppState((state) => ({ ...state, openNoteId: null }));
  }, [node?.id, appState.openNoteId, setAppState]);

  const close = () => closeMindWidgetPanel(board, setAppState);

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
            onClick={() => openMindWidget(setAppState, 'note', badge.id)}
          >
            {NoteIcon}
          </button>
        ))}
      </div>
      {node && (
        <aside
          className={`drawnix-note-panel ${ATTACHED_ELEMENT_CLASS_NAME}`}
          aria-label={t('notes.title')}
          {...getMindWidgetPanelProps(board, close, lastInputOperation)}
        >
          <header>
            <span>{t('notes.title')}</span>
            <button
              type="button"
              aria-label={t('notes.close')}
              title={t('notes.close')}
              onClick={close}
            >
              ×
            </button>
          </header>
          <textarea
            ref={textarea}
            id={`drawnix-note-${node.id}`}
            aria-label={t('notes.content')}
            value={draft}
            onBlur={() => {
              lastInputOperation.current = null;
            }}
            onChange={(event) => {
              const value = event.target.value;
              // Agent edits can replace or move the node before React renders again.
              const currentNode = findMindElement(board, node.id);
              if (!currentNode) return;
              // Plait notifies React asynchronously; update the input now to keep its caret.
              setDraft(value);
              if (value === (currentNode.note || '')) return;
              setNodeFromInput(
                board,
                currentNode,
                { note: value || undefined },
                lastInputOperation
              );
            }}
          />
        </aside>
      )}
    </>
  );
};
