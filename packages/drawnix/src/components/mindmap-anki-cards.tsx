import { useEffect, useRef, useState } from 'react';
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
  createAnkiCardId,
  getAnkiCards,
  parseAnkiTags,
  type MindmapAnkiCard,
} from '../anki-cards';
import { useDrawnix } from '../hooks/use-drawnix';
import { useI18n } from '../i18n';
import { AnkiCardIcon } from './icons';
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

type RawCard = Record<string, unknown>;

/** Card edits keep fields this version does not know about. */
function getRawCards(element: MindElement): RawCard[] {
  return Array.isArray(element.ankiCards) ? element.ankiCards : [];
}

export function createAnkiCardForNode(element: MindElement): MindmapAnkiCard {
  return {
    id: createAnkiCardId(),
    front: Node.string(element.data.topic),
    back: typeof element.note === 'string' ? element.note : '',
  };
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

const frontSelector = (cardId: string) =>
  `[id="drawnix-anki-${cardId}-front"]`;

const normalizeText = (text: string) => text;
const normalizeTags = (text: string) => parseAnkiTags(text).join(' ');

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
    <textarea rows={2} {...props} />
  ) : (
    <input type="text" autoComplete="off" spellCheck={false} {...props} />
  );
};

export const MindmapAnkiCards = () => {
  const board = useBoard();
  const { t } = useI18n();
  const { appState, setAppState } = useDrawnix();
  const panel = useRef<HTMLElement>(null);
  const lastInputOperation = useRef<PlaitOperation | null>(null);
  // Selector of the element to focus once it has rendered.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const badges = useMindNodeBadges(board, (element) => {
    const count = getAnkiCards(element).length;
    return count
      ? { count, offset: hasNote(element) ? NOTE_BADGE_OFFSET : 0 }
      : undefined;
  });
  const node = findMindElement(board, appState.openAnkiCardsId);
  const cards = getAnkiCards(node);

  useEffect(() => {
    lastInputOperation.current = null;
    setPendingFocus(null);
    if (node) {
      panel.current
        ?.querySelector<HTMLElement>('textarea, .drawnix-anki-add')
        ?.focus();
    } else if (appState.openAnkiCardsId) {
      setAppState((state) => ({ ...state, openAnkiCardsId: null }));
    }
  }, [node?.id, appState.openAnkiCardsId, setAppState]);

  // A new card renders after Plait's asynchronous change notification.
  useEffect(() => {
    if (!pendingFocus) return;
    const field = panel.current?.querySelector<HTMLElement>(pendingFocus);
    if (!field) return;
    field.focus();
    field.scrollIntoView?.({ block: 'nearest' });
    setPendingFocus(null);
  }, [pendingFocus, cards.length]);

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

  const setCardField = (
    nodeId: string,
    cardId: string,
    field: 'front' | 'back' | 'tags',
    value: string | string[]
  ) =>
    updateCards(
      nodeId,
      (raw) => {
        const index = raw.findIndex((card) => card?.id === cardId);
        if (index < 0) return null;
        const card = { ...raw[index] };
        if (field === 'tags') {
          const tags = value as string[];
          const current = Array.isArray(card.tags) ? card.tags : [];
          if (current.join(' ') === tags.join(' ')) return null;
          if (tags.length) card.tags = tags;
          else delete card.tags;
        } else {
          if (card[field] === value) return null;
          card[field] = value;
        }
        return raw.map((item, i) => (i === index ? card : item));
      },
      true
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
    if (created) setPendingFocus(frontSelector(created.id));
  };

  const deleteCard = (cardId: string) => {
    if (!node) return;
    const index = cards.findIndex((card) => card.id === cardId);
    updateCards(
      node.id,
      (raw) => raw.filter((card) => card?.id !== cardId),
      false
    );
    const neighbour = cards[index + 1] ?? cards[index - 1];
    setPendingFocus(
      neighbour ? frontSelector(neighbour.id) : '.drawnix-anki-add'
    );
  };

  const close = () => closeMindWidgetPanel(board, setAppState);
  const endInput = () => {
    lastInputOperation.current = null;
  };

  return (
    <>
      <div className="drawnix-anki-badges">
        {badges.map((badge) => {
          const label = `${t('anki.open')}: ${badge.topic} (${badge.value.count})`;
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
          className={`drawnix-anki-panel ${ATTACHED_ELEMENT_CLASS_NAME}`}
          aria-label={t('anki.title')}
          {...getMindWidgetPanelProps(board, close, lastInputOperation)}
        >
          <header>
            <span>
              {t('anki.title')}
              {cards.length > 0 && (
                <span className="drawnix-anki-count">{cards.length}</span>
              )}
            </span>
            <button
              type="button"
              aria-label={t('anki.close')}
              title={t('anki.close')}
              onClick={close}
            >
              ×
            </button>
          </header>
          <div className="drawnix-anki-list">
            {cards.length === 0 && (
              <p className="drawnix-anki-empty">{t('anki.empty')}</p>
            )}
            {cards.map((card, index) => {
              const name = `${t('anki.card')} ${index + 1}`;
              const fieldId = (field: string) =>
                `drawnix-anki-${card.id}-${field}`;
              return (
                <section
                  key={card.id}
                  className="drawnix-anki-card"
                  aria-label={name}
                  data-anki-card-id={card.id}
                >
                  <div className="drawnix-anki-card-header">
                    <span>{name}</span>
                    <button
                      type="button"
                      aria-label={`${t('anki.delete')}: ${name}`}
                      title={t('anki.delete')}
                      onClick={() => deleteCard(card.id)}
                    >
                      ×
                    </button>
                  </div>
                  <label htmlFor={fieldId('front')}>{t('anki.front')}</label>
                  <AnkiCardField
                    id={fieldId('front')}
                    label={`${name} ${t('anki.front')}`}
                    value={card.front}
                    multiline
                    onBlur={endInput}
                    onInput={(text) =>
                      setCardField(node.id, card.id, 'front', text)
                    }
                  />
                  <label htmlFor={fieldId('back')}>{t('anki.back')}</label>
                  <AnkiCardField
                    id={fieldId('back')}
                    label={`${name} ${t('anki.back')}`}
                    value={card.back}
                    multiline
                    onBlur={endInput}
                    onInput={(text) =>
                      setCardField(node.id, card.id, 'back', text)
                    }
                  />
                  <label htmlFor={fieldId('tags')}>{t('anki.tags')}</label>
                  <AnkiCardField
                    id={fieldId('tags')}
                    label={`${name} ${t('anki.tags')}`}
                    value={(card.tags ?? []).join(' ')}
                    placeholder={t('anki.tagsPlaceholder')}
                    normalize={normalizeTags}
                    onBlur={endInput}
                    onInput={(text) =>
                      setCardField(node.id, card.id, 'tags', parseAnkiTags(text))
                    }
                  />
                </section>
              );
            })}
          </div>
          <button
            type="button"
            className="drawnix-anki-add"
            onClick={addCard}
          >
            + {t('anki.new')}
          </button>
        </aside>
      )}
    </>
  );
};
