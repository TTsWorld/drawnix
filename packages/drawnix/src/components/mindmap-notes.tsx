import { useEffect, useRef, useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  type PlaitOperation,
} from '@plait/core';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import {
  closeMindWidgetPanel,
  findMindElement,
  getMindWidgetPanelProps,
  setNodeFromInput,
  useCloseOnOutsidePointerDown,
} from './mindmap-widgets';
import './mindmap-notes.scss';

export const MindmapNotes = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const panel = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastInputOperation = useRef<PlaitOperation | null>(null);
  const node = findMindElement(board, appState.openNoteId);
  const note = typeof node?.note === 'string' ? node.note : '';
  const [draft, setDraft] = useState(note);

  useEffect(() => {
    setDraft(note);
  }, [node?.id, note]);

  useEffect(() => {
    lastInputOperation.current = null;
    if (node) {
      textarea.current?.focus();
    } else if (appState.openNoteId) {
      setAppState((state) => ({ ...state, openNoteId: null }));
    }
  }, [node?.id, appState.openNoteId, setAppState]);

  const close = () => closeMindWidgetPanel(board, setAppState);
  useCloseOnOutsidePointerDown(panel, !!node, setAppState);

  if (!node) return null;

  return (
    <aside
      ref={panel}
      // Presses on the panel background keep focus, and keys, in the panel.
      tabIndex={-1}
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
  );
};
