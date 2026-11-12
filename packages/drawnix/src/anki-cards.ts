import type { PlaitElement } from '@plait/core';
import { MindElement, PlaitMind } from '@plait/mind';
import { Node } from 'slate';

/**
 * An Anki card attached to a mind-map node, stored at `MindElement.ankiCards`.
 * Like notes it lives outside `data`, because Plait rebuilds `data` in some
 * transforms (for example when removing an emoji).
 *
 * `front` and `back` are plain multiline text; exporters convert them to
 * Anki's HTML fields. `frontImages` and `backImages` are images shown after the
 * text of that side, in order. `id` is stable for the life of the card so
 * that repeated exports can use it as the Anki note GUID.
 */
export interface MindmapAnkiCard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
  frontImages?: MindmapAnkiCardMedia[];
  backImages?: MindmapAnkiCardMedia[];
}

/**
 * An image on one side of a card, stored inline as a data URL like other
 * Drawnix images. `id` never changes and an image is never edited in place,
 * so equal IDs mean equal content (exporters can use it as the media file
 * name).
 */
export interface MindmapAnkiCardMedia {
  id: string;
  /** `data:` URL (images added in the panel) or an external URL. */
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

export type MindmapAnkiCardSide = 'front' | 'back';

export const ANKI_CARD_IMAGE_FIELDS = {
  front: 'frontImages',
  back: 'backImages',
} as const;

export interface MindmapAnkiCardImage {
  url: string;
  width: number;
  height: number;
}

/** All cards of one node, in document order, for host-side export. */
export interface MindmapAnkiCardNode {
  nodeId: string;
  topic: string;
  /** Reference to the node's own image (`data.image`), if it has one. */
  image?: MindmapAnkiCardImage;
  cards: MindmapAnkiCard[];
}

export function createAnkiCardId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // RFC 4122 version 4 layout; getRandomValues also works outside secure contexts.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((group) => group.join(''))
    .join('-');
}

/** Anki tags cannot contain spaces; whitespace separates them. */
export function parseAnkiTags(text: string): string[] {
  return Array.from(new Set(text.split(/\s+/).filter(Boolean)));
}

type StoredAnkiCard = Record<string, unknown> & { id: string };

function isStoredAnkiCard(card: unknown): card is StoredAnkiCard {
  return (
    !!card &&
    typeof card === 'object' &&
    typeof (card as { id?: unknown }).id === 'string' &&
    !!(card as { id: string }).id
  );
}

function getMimeType(url: string): string {
  return /^data:([^;,]+)[;,]/.exec(url)?.[1] ?? '';
}

/** Reads one side's images, ignoring malformed entries. */
export function getAnkiCardImages(value: unknown): MindmapAnkiCardMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (image): image is Record<string, unknown> =>
        !!image &&
        typeof image === 'object' &&
        typeof image.id === 'string' &&
        !!image.id &&
        typeof image.url === 'string' &&
        !!image.url
    )
    .map((image) => {
      const url = image.url as string;
      const number = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0
          ? value
          : 0;
      return {
        id: image.id as string,
        url,
        mimeType:
          typeof image.mimeType === 'string' && image.mimeType
            ? image.mimeType
            : getMimeType(url),
        width: number(image.width),
        height: number(image.height),
      };
    });
}

/** Reads a node's cards, ignoring malformed entries from external edits. */
export function getAnkiCards(
  element: PlaitElement | undefined
): MindmapAnkiCard[] {
  const value = element?.['ankiCards'];
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredAnkiCard).map((card) => {
    const tags = Array.isArray(card.tags)
      ? card.tags.filter(
          (tag): tag is string => typeof tag === 'string' && !!tag
        )
      : [];
    const frontImages = getAnkiCardImages(card.frontImages);
    const backImages = getAnkiCardImages(card.backImages);
    return {
      id: card.id as string,
      front: typeof card.front === 'string' ? card.front : '',
      back: typeof card.back === 'string' ? card.back : '',
      ...(tags.length ? { tags } : {}),
      ...(frontImages.length ? { frontImages } : {}),
      ...(backImages.length ? { backImages } : {}),
    };
  });
}

function forEachMindElement(
  elements: PlaitElement[],
  visit: (element: MindElement) => void
) {
  const walk = (element: MindElement) => {
    visit(element);
    element.children
      .filter((child) => MindElement.isMindElement(null, child))
      .forEach(walk);
  };
  elements.filter(PlaitMind.isMind).forEach(walk);
}

/** Lists every node that has cards, depth-first in document order. */
export function getMindmapAnkiCards(
  elements: PlaitElement[]
): MindmapAnkiCardNode[] {
  const result: MindmapAnkiCardNode[] = [];
  forEachMindElement(elements, (element) => {
    const cards = getAnkiCards(element);
    if (!cards.length) return;
    const image = element.data?.image;
    result.push({
      nodeId: element.id,
      topic: Node.string(element.data.topic),
      ...(image && typeof image.url === 'string'
        ? {
            image: {
              url: image.url,
              width: image.width,
              height: image.height,
            },
          }
        : {}),
      cards,
    });
  });
  return result;
}

function collectAnkiCardIds(elements: PlaitElement[], ids: Set<string>) {
  for (const element of elements) {
    for (const card of getAnkiCards(element)) ids.add(card.id);
    if (Array.isArray(element.children)) {
      collectAnkiCardIds(element.children, ids);
    }
  }
  return ids;
}

// Set on clipboard elements built by a cut, with one token per cut; removed
// again when pasting.
const CUT_MARK = 'ankiCardsCut';

function hasAnkiCards(element: PlaitElement): boolean {
  return (
    getAnkiCards(element).length > 0 ||
    (Array.isArray(element.children) && element.children.some(hasAnkiCards))
  );
}

/**
 * Marks cut clipboard elements that contain cards, so that pasting them moves
 * the cards instead of copying them.
 */
export function markAnkiCardsCut(
  elements: PlaitElement[],
  cutId: string = createAnkiCardId()
): PlaitElement[] {
  return elements.map((element) =>
    hasAnkiCards(element) ? { ...element, [CUT_MARK]: cutId } : element
  );
}

/**
 * Prepares clipboard elements for pasting. Copied or duplicated cards always
 * get new IDs, so a copy never shares an Anki GUID with its source, even in
 * another document. Cut cards keep their IDs (the source has been removed)
 * only on the first paste of that cut: `pastedCuts` holds cuts that were
 * already pasted, in any document, and is updated with this paste. An ID that
 * is already on the board is always renewed. Card objects are otherwise kept
 * as they are, including unknown fields.
 */
export function prepareAnkiCardsForPaste(
  elements: PlaitElement[],
  existing: PlaitElement[],
  pastedCuts: Set<string>
): PlaitElement[] {
  const used = collectAnkiCardIds(existing, new Set());
  const renew = (element: PlaitElement, isCut: boolean): PlaitElement => {
    let result = element;
    const cards: unknown = element['ankiCards'];
    if (Array.isArray(cards)) {
      result = {
        ...result,
        ankiCards: cards.map((card) => {
          // Malformed entries are left alone; readers skip them.
          if (!isStoredAnkiCard(card)) return card;
          const keep = isCut && !used.has(card.id);
          const id = keep ? card.id : createAnkiCardId();
          used.add(id);
          return keep ? card : { ...card, id };
        }),
      };
    }
    if (Array.isArray(element.children)) {
      result = {
        ...result,
        children: element.children.map((child) => renew(child, isCut)),
      };
    }
    return result;
  };
  const cuts = new Set<string>();
  const prepared = elements.map((element) => {
    const { [CUT_MARK]: cutId, ...rest } = element;
    const isCut = typeof cutId === 'string' && !pastedCuts.has(cutId);
    if (typeof cutId === 'string') cuts.add(cutId);
    return renew(rest as PlaitElement, isCut);
  });
  // Elements of one cut share its ID; record it after the whole paste.
  cuts.forEach((cutId) => pastedCuts.add(cutId));
  return prepared;
}
