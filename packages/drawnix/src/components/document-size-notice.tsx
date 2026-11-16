import { useContext, useEffect, useRef, useState } from 'react';
import { BoardContext, useBoard } from '@plait-board/react-board';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import {
  DOCUMENT_SIZE_LIMIT,
  DOCUMENT_SIZE_WARNING,
  formatMiB,
} from '../anki-card-images';
import { getDocumentSize } from '../document-size';
import { onFragmentRefused } from '../plugins/with-document-size-limit';
import { useI18n } from '../i18n';
import './document-size-notice.scss';

/** Measuring serializes the document; wait for a pause in editing. */
export const DOCUMENT_SIZE_CHECK_DELAY = 500;

type Level = 'large' | 'tooLarge';

/**
 * Reports a document that is close to or over DOCUMENT_SIZE_LIMIT after any
 * change (paste, duplicate, redo, Agent commands, images), and pastes that
 * withDocumentSizeLimit refused. Viewport and selection changes keep the same
 * elements and are not measured again.
 */
export const DocumentSizeNotice = () => {
  const board = useBoard();
  const version = useContext(BoardContext)?.v;
  const { t } = useI18n();
  const [size, setSize] = useState(0);
  const [refused, setRefused] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Level | null>(null);
  const measured = useRef<unknown>(null);
  // The document when a paste was refused. The refusal stays until the user
  // closes it or the document changes after it; a measurement already
  // pending for an earlier edit does not clear it.
  const refusedOn = useRef<unknown>(null);

  useEffect(
    () =>
      onFragmentRefused(board, (projected) => {
        refusedOn.current = board.children;
        setRefused(projected);
      }),
    [board]
  );

  useEffect(() => {
    if (measured.current === board.children) return;
    const timer = setTimeout(() => {
      measured.current = board.children;
      setSize(getDocumentSize(board));
      if (refusedOn.current !== board.children) setRefused(null);
    }, DOCUMENT_SIZE_CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [board, version]);

  const level: Level | null =
    size > DOCUMENT_SIZE_LIMIT
      ? 'tooLarge'
      : size > DOCUMENT_SIZE_WARNING
      ? 'large'
      : null;
  useEffect(() => {
    // Dismissing hides one level; reaching another shows the notice again.
    if (dismissed && dismissed !== level) setDismissed(null);
  }, [dismissed, level]);

  let text: string | null = null;
  let error = false;
  if (refused !== null) {
    text = t('document.pasteRefused').replace('{size}', formatMiB(refused));
    error = true;
  } else if (level && level !== dismissed) {
    text = t(
      level === 'tooLarge' ? 'document.tooLarge' : 'document.large'
    ).replace('{size}', formatMiB(size));
    error = level === 'tooLarge';
  }
  if (!text) return null;
  return (
    <div
      className={`drawnix-size-notice ${ATTACHED_ELEMENT_CLASS_NAME} ${
        error ? 'drawnix-size-notice--error' : ''
      }`}
      role={error ? 'alert' : 'status'}
    >
      <span>{text}</span>
      <button
        type="button"
        aria-label={t('document.dismiss')}
        title={t('document.dismiss')}
        onClick={() => {
          if (refused !== null) setRefused(null);
          else setDismissed(level);
        }}
      >
        ×
      </button>
    </div>
  );
};
