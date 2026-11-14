import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  getSelectedElements,
  PlaitBoard,
  PlaitHistoryBoard,
  type PlaitOperation,
  Transforms,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import { Node } from 'slate';
import {
  ANKI_CARD_IMAGE_FIELDS,
  createAnkiCardId,
  getAnkiCards,
  parseAnkiTags,
  type MindmapAnkiCard,
  type MindmapAnkiCardMedia,
  type MindmapAnkiCardSide,
} from '../anki-cards';
import {
  ANKI_IMAGE_ACCEPT,
  AnkiImageError,
  checkDocumentBudget,
  createAnkiCardImage,
  DOCUMENT_SIZE_WARNING,
  formatMiB,
  getImageFiles,
  getUtf8Size,
  hasFiles,
  type AnkiImageCodec,
} from '../anki-card-images';
import { serializeDrawnixBoard } from '../editor';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n, type Translations } from '../i18n';
import { AnkiCardIcon, ImageIcon, PlusIcon } from './icons';
import { AnkiCardPicker } from './mindmap-anki-card-picker';
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
import './mindmap-anki-cards.scss';

// The note badge (24px) and a 4px gap come first when a node has both.
const NOTE_BADGE_OFFSET = 28;
const SIDES: MindmapAnkiCardSide[] = ['front', 'back'];

type RawCard = Record<string, unknown>;

/** Card edits keep fields this version does not know about. */
function getRawCards(element: MindElement): RawCard[] {
  return Array.isArray(element.ankiCards) ? element.ankiCards : [];
}

/**
 * The front starts with the node title, the usual question. The note is not
 * copied: notes and cards are separate content, and a copy would look like
 * the two were linked.
 */
export function createAnkiCardForNode(element: MindElement): MindmapAnkiCard {
  return {
    id: createAnkiCardId(),
    front: Node.string(element.data.topic),
    back: '',
  };
}

/** Tests replace the canvas codec; the browser codec is the default. */
let imageCodec: AnkiImageCodec | undefined;
export function setAnkiImageCodecForTesting(codec?: AnkiImageCodec) {
  imageCodec = codec;
}

export const MindmapAnkiCardButton = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { setAppState } = useDrawnix();
  const selected = getSelectedElements(board);
  if (selected.length !== 1 || !MindElement.isMindElement(board, selected[0])) {
    return null;
  }
  const node = selected[0];
  const label = t(getAnkiCards(node).length ? 'anki.open' : 'anki.add');
  return (
    <ToolButton
      type="button"
      className="property-button"
      visible
      icon={AnkiCardIcon}
      title={label}
      aria-label={label}
      onClick={() => openMindWidget(setAppState, 'ankiCards', node.id)}
    />
  );
};

const fieldId = (cardId: string, field: string) =>
  `drawnix-anki-${cardId}-${field}`;
const fieldSelector = (cardId: string, field: string) =>
  `[id="${fieldId(cardId, field)}"]`;

const normalizeText = (text: string) => text;
const normalizeTags = (text: string) => parseAnkiTags(text).join(' ');

function summarize(text: string, empty: string) {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return empty;
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

const AnkiCardField = ({
  id,
  label,
  value,
  multiline,
  placeholder,
  normalize = normalizeText,
  onInput,
  onBlur,
}: {
  id: string;
  label: string;
  /** Stored value in its normalized text form. */
  value: string;
  multiline?: boolean;
  placeholder?: string;
  normalize?: (text: string) => string;
  /** Returns false when the edit could not be applied. */
  onInput: (text: string) => boolean;
  onBlur: () => void;
}) => {
  const [draft, setDraft] = useState(value);
  // Keep in-progress text such as a trailing space between tags unless the
  // document changed it (undo, Agent edits).
  useEffect(() => {
    setDraft((current) => (normalize(current) === value ? current : value));
  }, [value, normalize]);
  const props = {
    id,
    'aria-label': label,
    value: draft,
    placeholder,
    onBlur,
    onChange: (
      event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>
    ) => {
      const text = event.target.value;
      // Plait notifies React asynchronously; update the input now to keep its caret.
      if (onInput(text)) setDraft(text);
    },
  };
  return multiline ? (
    <textarea rows={3} {...props} />
  ) : (
    <input type="text" autoComplete="off" spellCheck={false} {...props} />
  );
};

type Notice = {
  kind: 'error' | 'warning' | 'status';
  text: string;
  /** Card the notice is about; it is shown only with that card. */
  cardId?: string;
};

function renderNotice(notice: Notice) {
  return (
    <p
      className={`drawnix-anki-notice drawnix-anki-notice--${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      {notice.text}
    </p>
  );
}

function imageErrorText(
  error: unknown,
  t: (key: keyof Translations) => string,
  projected?: number
) {
  const code = error instanceof AnkiImageError ? error.code : 'unreadable';
  if (code === 'unsupported') return t('anki.imageUnsupported');
  if (code === 'too-large') return t('anki.imageTooLarge');
  if (code === 'document-full') {
    return t('anki.documentFull').replace('{size}', formatMiB(projected ?? 0));
  }
  return t('anki.imageUnreadable');
}

export const MindmapAnkiCards = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewReturnFocus = useRef<HTMLElement | null>(null);
  const lastInputOperation = useRef<PlaitOperation | null>(null);
  // Selector of the element to focus once it has rendered.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    nodeId: string;
    cardId: string | null;
    side: MindmapAnkiCardSide;
  } | null>(null);
  const lastIndex = useRef<{ nodeId?: string; index: number }>({ index: 0 });
  const [notice, setNotice] = useState<Notice | null>(null);
  // Number of image batches being processed; batches run one after another.
  const [pending, setPending] = useState(0);
  const busy = pending > 0;
  const imageQueue = useRef<Promise<void>>(Promise.resolve());
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const badges = useMindNodeBadges(board, (element) => {
    const count = getAnkiCards(element).length;
    return count
      ? { count, offset: hasNote(element) ? NOTE_BADGE_OFFSET : 0 }
      : undefined;
  });
  const node = findMindElement(board, appState.openAnkiCardsId);
  const cards = getAnkiCards(node);

  // The selected card survives undo/redo; if it disappears, select its
  // neighbour at the same position.
  const ownSelection =
    selection && node && selection.nodeId === node.id ? selection : null;
  let index = cards.findIndex((card) => card.id === ownSelection?.cardId);
  if (index < 0) {
    const previous =
      lastIndex.current.nodeId === node?.id ? lastIndex.current.index : 0;
    index = Math.max(0, Math.min(previous, cards.length - 1));
  }
  lastIndex.current = { nodeId: node?.id, index };
  const current: MindmapAnkiCard | undefined = cards[index];
  const side: MindmapAnkiCardSide = ownSelection?.side ?? 'front';
  const cardName = `${t('anki.card')} ${index + 1}`;

  const select = (cardId: string | null, nextSide = side) => {
    if (!node) return;
    lastInputOperation.current = null;
    setNotice(null);
    setSelection({ nodeId: node.id, cardId, side: nextSide });
  };

  useEffect(() => {
    lastInputOperation.current = null;
    setPendingFocus(null);
    setNotice(null);
    setPreview(null);
    setDragging(false);
    if (node) {
      panel.current
        ?.querySelector<HTMLElement>('textarea, .drawnix-anki-add')
        ?.focus();
    } else if (appState.openAnkiCardsId) {
      setAppState((state) => ({ ...state, openAnkiCardsId: null }));
    }
  }, [node?.id, appState.openAnkiCardsId, setAppState]);

  // New cards and switched tabs render after Plait's asynchronous notification.
  useEffect(() => {
    if (!pendingFocus) return;
    const field = panel.current?.querySelector<HTMLElement>(pendingFocus);
    if (!field) return;
    field.focus();
    setPendingFocus(null);
  }, [pendingFocus, cards.length, current?.id, side]);

  useEffect(() => {
    if (preview) {
      panel.current
        ?.querySelector<HTMLElement>('.drawnix-anki-preview button')
        ?.focus();
    }
  }, [preview]);

  /**
   * Applies a card change to the node in the current document. `update`
   * returns null when nothing changes. Input edits merge into one undo step
   * per field; other edits start a new step.
   */
  const updateCards = (
    nodeId: string,
    update: (cards: RawCard[], element: MindElement) => RawCard[] | null,
    fromInput: boolean
  ): boolean => {
    // Agent edits can replace or move the node before React renders again.
    const element = findMindElement(board, nodeId);
    if (!element) return false;
    const next = update(getRawCards(element), element);
    if (!next) return true;
    const properties = { ankiCards: next.length ? next : undefined };
    if (fromInput) {
      setNodeFromInput(board, element, properties, lastInputOperation);
      return true;
    }
    lastInputOperation.current = null;
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(
        board,
        properties,
        PlaitBoard.findPath(board, element)
      );
    });
    return true;
  };

  const updateCard = (
    nodeId: string,
    cardId: string,
    update: (card: RawCard) => RawCard | null,
    fromInput: boolean
  ) =>
    updateCards(
      nodeId,
      (raw) => {
        const at = raw.findIndex((card) => card?.id === cardId);
        if (at < 0) return null;
        const card = update({ ...raw[at] });
        return card ? raw.map((item, i) => (i === at ? card : item)) : null;
      },
      fromInput
    );

  const setText = (
    nodeId: string,
    cardId: string,
    field: MindmapAnkiCardSide,
    value: string
  ) =>
    updateCard(
      nodeId,
      cardId,
      (card) => {
        if (card[field] === value) return null;
        card[field] = value;
        return card;
      },
      true
    );

  const setTags = (nodeId: string, cardId: string, tags: string[]) =>
    updateCard(
      nodeId,
      cardId,
      (card) => {
        const current = Array.isArray(card.tags) ? card.tags : [];
        if (current.join(' ') === tags.join(' ')) return null;
        if (tags.length) card.tags = tags;
        else delete card.tags;
        return card;
      },
      true
    );

  const setImages = (
    nodeId: string,
    cardId: string,
    imageSide: MindmapAnkiCardSide,
    change: (images: unknown[]) => unknown[]
  ) =>
    updateCard(
      nodeId,
      cardId,
      (card) => {
        const field = ANKI_CARD_IMAGE_FIELDS[imageSide];
        const images = change(
          Array.isArray(card[field]) ? (card[field] as unknown[]) : []
        );
        if (images.length) card[field] = images;
        else delete card[field];
        return card;
      },
      false
    );

  const addCard = () => {
    if (!node) return;
    let created: MindmapAnkiCard | undefined;
    updateCards(
      node.id,
      (raw, element) => {
        created = createAnkiCardForNode(element);
        return [...raw, { ...created }];
      },
      false
    );
    if (created) {
      select(created.id, 'front');
      setPendingFocus(fieldSelector(created.id, 'front'));
    }
  };

  /** One undo step; the notice tells how to bring the card back. */
  const deleteCard = () => {
    if (!node || !current) return;
    const neighbour = cards[index + 1] ?? cards[index - 1];
    const deleted = updateCards(
      node.id,
      (raw) => raw.filter((card) => card?.id !== current.id),
      false
    );
    if (!deleted) return;
    select(neighbour?.id ?? null);
    setNotice({
      kind: 'status',
      text: t('anki.deleted').replace('{card}', cardName),
    });
    setPendingFocus(
      neighbour ? fieldSelector(neighbour.id, side) : '.drawnix-anki-add'
    );
  };

  /**
   * Adds images to the side that is open now. Batches added while another is
   * still processing are queued, never dropped. The target card is checked
   * again before writing: it can be deleted or undone away meanwhile.
   */
  const addImages = (files: File[]) => {
    if (!node || !current || !files.length) return;
    const target = { nodeId: node.id, cardId: current.id, side };
    const notify = (value: Notice | null) =>
      setNotice(value && { ...value, cardId: target.cardId });
    setPending((count) => count + 1);
    notify({ kind: 'status', text: t('anki.imagesAdding') });
    imageQueue.current = imageQueue.current.then(async () => {
      const added: MindmapAnkiCardMedia[] = [];
      let failure: Notice | null = null;
      for (const file of files) {
        try {
          added.push(await createAnkiCardImage(file, imageCodec));
        } catch (error) {
          failure ??= { kind: 'error', text: imageErrorText(error, t) };
        }
      }
      let warning: Notice | null = null;
      const exists = getAnkiCards(findMindElement(board, target.nodeId)).some(
        (card) => card.id === target.cardId
      );
      if (added.length && !exists) {
        // Shown with whichever card is open, since the target is gone.
        setPending((count) => count - 1);
        setNotice({ kind: 'error', text: t('anki.imageTargetGone') });
        return;
      }
      if (added.length) {
        const size = getUtf8Size(serializeDrawnixBoard(board));
        try {
          const projected = checkDocumentBudget(
            size,
            added.map((image) => image.url)
          );
          setImages(target.nodeId, target.cardId, target.side, (images) => [
            ...images,
            ...added,
          ]);
          if (projected > DOCUMENT_SIZE_WARNING) {
            warning = {
              kind: 'warning',
              text: t('anki.documentLarge').replace(
                '{size}',
                formatMiB(projected)
              ),
            };
          }
        } catch (error) {
          const projected =
            size + added.reduce((total, image) => total + image.url.length, 0);
          failure = {
            kind: 'error',
            text: imageErrorText(error, t, projected),
          };
          added.length = 0;
        }
      }
      setPending((count) => count - 1);
      notify(
        failure ??
          warning ??
          (added.length
            ? { kind: 'status', text: t('anki.imagesAdded') }
            : null)
      );
    });
  };

  const removeImage = (imageId: string) => {
    if (!node || !current) return;
    setNotice(null);
    setImages(node.id, current.id, side, (images) =>
      images.filter(
        (image) => (image as { id?: unknown } | null)?.id !== imageId
      )
    );
    setPendingFocus('.drawnix-anki-image-add');
  };

  const close = () => closeMindWidgetPanel(board, setAppState);
  const closePreview = () => {
    setPreview(null);
    previewReturnFocus.current?.focus();
  };
  const endInput = () => {
    lastInputOperation.current = null;
  };
  const panelProps = getMindWidgetPanelProps(board, close, lastInputOperation);

  /** Pasted or dropped files go to the current side; never to the board. */
  const takeFiles = (data: DataTransfer | null) => {
    const files = getImageFiles(data);
    if (!files.length) {
      setNotice({ kind: 'error', text: t('anki.imageUnsupported') });
      return;
    }
    addImages(files);
  };

  const images = current ? current[ANKI_CARD_IMAGE_FIELDS[side]] ?? [] : [];

  return (
    <>
      <div className="drawnix-anki-badges">
        {badges.map((badge) => {
          const label = `${t('anki.open')}: ${badge.topic} (${
            badge.value.count
          })`;
          return (
            <button
              key={badge.id}
              type="button"
              className={`drawnix-anki-badge ${ATTACHED_ELEMENT_CLASS_NAME}`}
              style={{ left: badge.x + badge.value.offset, top: badge.y }}
              data-anki-node-id={badge.id}
              title={label}
              aria-label={label}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => openMindWidget(setAppState, 'ankiCards', badge.id)}
            >
              {AnkiCardIcon}
              <span>{badge.value.count}</span>
            </button>
          );
        })}
      </div>
      {node && (
        <aside
          ref={panel}
          className={`drawnix-anki-panel ${ATTACHED_ELEMENT_CLASS_NAME} ${
            dragging ? 'drawnix-anki-panel--dragging' : ''
          }`}
          aria-label={t('anki.title')}
          {...panelProps}
          onKeyDown={(event) => {
            if (preview && event.key === 'Escape') {
              event.stopPropagation();
              event.preventDefault();
              closePreview();
              return;
            }
            panelProps.onKeyDown?.(event);
          }}
          onPaste={(event) => {
            event.stopPropagation();
            // Office apps put an image next to copied text; text wins.
            if (
              !hasFiles(event.clipboardData) ||
              event.clipboardData.getData('text/plain').trim()
            ) {
              return;
            }
            // Image paste belongs to the current card side, not the textarea.
            event.preventDefault();
            if (current) takeFiles(event.clipboardData);
          }}
          onDragEnter={(event) => {
            event.stopPropagation();
            if (hasFiles(event.dataTransfer) && current) setDragging(true);
          }}
          onDragOver={(event) => {
            event.stopPropagation();
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = current ? 'copy' : 'none';
          }}
          onDragLeave={(event) => {
            event.stopPropagation();
            if (
              !event.currentTarget.contains(
                event.relatedTarget as HTMLElement | null
              )
            ) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.stopPropagation();
            setDragging(false);
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            if (current) takeFiles(event.dataTransfer);
          }}
        >
          <header>
            {current ? (
              <AnkiCardPicker
                items={cards.map((card, i) => ({
                  id: card.id,
                  label: `${t('anki.card')} ${i + 1} · ${summarize(
                    card.front,
                    t('anki.emptyFront')
                  )}`,
                }))}
                currentIndex={index}
                selectLabel={t('anki.select')}
                deleteLabel={t('anki.deleteCurrent')}
                onSelect={(cardId) => select(cardId)}
                onDelete={deleteCard}
              />
            ) : (
              <span>{t('anki.title')}</span>
            )}
            <button
              type="button"
              className="drawnix-anki-add"
              aria-label={t('anki.new')}
              title={t('anki.new')}
              onClick={addCard}
            >
              {PlusIcon}
            </button>
            <button
              type="button"
              className="drawnix-anki-close"
              aria-label={t('anki.close')}
              title={t('anki.close')}
              onClick={close}
            >
              ×
            </button>
          </header>
          {!current ? (
            <div className="drawnix-anki-empty">
              <p>{t('anki.empty')}</p>
              {notice && !notice.cardId && renderNotice(notice)}
            </div>
          ) : (
            <section
              className="drawnix-anki-card"
              aria-label={cardName}
              data-anki-card-id={current.id}
            >
              <div
                className="drawnix-anki-tabs"
                role="tablist"
                aria-label={t('anki.sides')}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                    return;
                  }
                  event.preventDefault();
                  const next = side === 'front' ? 'back' : 'front';
                  select(current.id, next);
                  setPendingFocus(
                    `[id="${fieldId(current.id, `tab-${next}`)}"]`
                  );
                }}
              >
                {SIDES.map((value) => {
                  const count = current[ANKI_CARD_IMAGE_FIELDS[value]]?.length;
                  return (
                    <button
                      key={value}
                      id={fieldId(current.id, `tab-${value}`)}
                      type="button"
                      role="tab"
                      aria-selected={side === value}
                      aria-controls={fieldId(current.id, `panel-${value}`)}
                      tabIndex={side === value ? 0 : -1}
                      onClick={() => select(current.id, value)}
                    >
                      {t(value === 'front' ? 'anki.front' : 'anki.back')}
                      {!!count && (
                        <span className="drawnix-anki-tab-count" aria-hidden>
                          {ImageIcon}
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div
                className="drawnix-anki-side"
                role="tabpanel"
                id={fieldId(current.id, `panel-${side}`)}
                aria-labelledby={fieldId(current.id, `tab-${side}`)}
              >
                <AnkiCardField
                  key={`${current.id}-${side}`}
                  id={fieldId(current.id, side)}
                  label={`${cardName} ${t(
                    side === 'front' ? 'anki.front' : 'anki.back'
                  )}`}
                  value={current[side]}
                  multiline
                  onBlur={endInput}
                  onInput={(text) => setText(node.id, current.id, side, text)}
                />
                <div className="drawnix-anki-images">
                  {images.map((image, i) => {
                    const label = `${t('anki.image')} ${i + 1}`;
                    return (
                      <div
                        key={image.id}
                        className="drawnix-anki-image"
                        data-anki-image-id={image.id}
                      >
                        <button
                          type="button"
                          className="drawnix-anki-image-preview"
                          aria-label={`${t('anki.previewImage')}: ${label}`}
                          title={t('anki.previewImage')}
                          onClick={(event) => {
                            previewReturnFocus.current = event.currentTarget;
                            setPreview({ url: image.url, label });
                          }}
                        >
                          <img src={image.url} alt={label} draggable={false} />
                        </button>
                        <button
                          type="button"
                          className="drawnix-anki-image-remove"
                          aria-label={`${t('anki.removeImage')}: ${label}`}
                          title={t('anki.removeImage')}
                          onClick={() => removeImage(image.id)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="drawnix-anki-image-add"
                    aria-label={t('anki.addImage')}
                    title={t('anki.addImage')}
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {ImageIcon}
                    <span>{t('anki.addImage')}</span>
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ANKI_IMAGE_ACCEPT}
                    multiple
                    hidden
                    data-testid="drawnix-anki-image-input"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = '';
                      addImages(files);
                    }}
                  />
                </div>
                <p className="drawnix-anki-hint">{t('anki.imageHint')}</p>
                {notice &&
                  (!notice.cardId || notice.cardId === current.id) &&
                  renderNotice(notice)}
              </div>
              <label htmlFor={fieldId(current.id, 'tags')}>
                {t('anki.tags')}
              </label>
              <AnkiCardField
                key={`${current.id}-tags`}
                id={fieldId(current.id, 'tags')}
                label={`${cardName} ${t('anki.tags')}`}
                value={(current.tags ?? []).join(' ')}
                placeholder={t('anki.tagsPlaceholder')}
                normalize={normalizeTags}
                onBlur={endInput}
                onInput={(text) =>
                  setTags(node.id, current.id, parseAnkiTags(text))
                }
              />
            </section>
          )}
          {preview && (
            <div
              className="drawnix-anki-preview"
              role="dialog"
              aria-label={preview.label}
            >
              <button
                type="button"
                aria-label={t('anki.closePreview')}
                title={t('anki.closePreview')}
                onClick={closePreview}
              >
                ×
              </button>
              <img src={preview.url} alt={preview.label} />
            </div>
          )}
        </aside>
      )}
    </>
  );
};
