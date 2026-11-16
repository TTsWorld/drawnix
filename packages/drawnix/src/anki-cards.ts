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
 * Drawnix images. The panel never changes an image's `id` or edits an image
 * in place, so in documents it wrote, equal IDs mean equal content.
 *
 * Readers (getAnkiCards, readAnkiCards) only return images whose `id` is
 * UUID-shaped and whose `url` is a base64 `data:` URL of PNG, JPEG, GIF or
 * WebP; `mimeType` is taken from the URL. Anything else (external URLs,
 * SVG, path-like IDs) is skipped and never shown or exported. Documents are
 * still untrusted input: exporters must not use these values as file paths
 * without their own checks, and should name media by content (for example a
 * hash), since an edited document can give different images the same ID.
 */
export interface MindmapAnkiCardMedia {
  id: string;
  /** `data:image/(png|jpeg|gif|webp);base64,…` */
  url: string;
  /** From the data URL: `image/png`, `image/jpeg`, `image/gif` or `image/webp`. */
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_DATA_URL =
  /^data:(image\/(?:png|jpeg|gif|webp));base64,[A-Za-z0-9+/]+={0,2}$/;

/** Whether an image ID has the UUID shape the panel creates. */
export function isAnkiCardImageId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * Reads one side's images, skipping entries that are malformed or not an
 * inline PNG, JPEG, GIF or WebP with a UUID-shaped ID (see
 * MindmapAnkiCardMedia), and later entries that repeat an ID.
 */
export function getAnkiCardImages(value: unknown): MindmapAnkiCardMedia[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: MindmapAnkiCardMedia[] = [];
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 0;
  for (const image of value) {
    if (!image || typeof image !== 'object') continue;
    const { id, url } = image as Record<string, unknown>;
    if (!isAnkiCardImageId(id) || seen.has(id) || typeof url !== 'string') {
      continue;
    }
    const mimeType = IMAGE_DATA_URL.exec(url)?.[1];
    if (!mimeType) continue;
    seen.add(id);
    result.push({
      id,
      url,
      mimeType,
      width: number((image as Record<string, unknown>).width),
      height: number((image as Record<string, unknown>).height),
    });
  }
  return result;
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

/** Whether a node has at least one card, without reading the cards. */
export function nodeHasAnkiCards(element: PlaitElement | undefined): boolean {
  const value = element?.['ankiCards'];
  return Array.isArray(value) && value.some(isStoredAnkiCard);
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

/** Lists every node that has cards, depth-first in document order. Card IDs
 * in the result are unique: duplicates are resolved like
 * normalizeAnkiCardIds, which the editor also writes back to the document. */
export function getMindmapAnkiCards(
  elements: PlaitElement[]
): MindmapAnkiCardNode[] {
  const result: MindmapAnkiCardNode[] = [];
  forEachMindElement(normalizeAnkiCardIds(elements), (element) => {
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

export function collectAnkiCardIds(elements: PlaitElement[], ids: Set<string>) {
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
 * another document. Cut cards keep their IDs only when `isMove` accepts the
 * cut (the editor accepts cuts made on the same board whose source removal
 * is in its undo history). An ID that is already on the board is always
 * renewed. Card objects are otherwise kept as they are, including unknown
 * fields.
 */
export function prepareAnkiCardsForPaste(
  elements: PlaitElement[],
  existing: PlaitElement[],
  isMove: (cutId: string) => boolean = () => false
): PlaitElement[] {
  const used = collectAnkiCardIds(existing, new Set());
  const renew = (element: PlaitElement, keepIds: boolean): PlaitElement => {
    let result = element;
    const cards: unknown = element['ankiCards'];
    if (Array.isArray(cards)) {
      result = {
        ...result,
        ankiCards: cards.map((card) => {
          // Malformed entries are left alone; readers skip them.
          if (!isStoredAnkiCard(card)) return card;
          const keep = keepIds && !used.has(card.id);
          const id = keep ? card.id : createAnkiCardId();
          used.add(id);
          return keep ? card : { ...card, id };
        }),
      };
    }
    if (Array.isArray(element.children)) {
      result = {
        ...result,
        children: element.children.map((child) => renew(child, keepIds)),
      };
    }
    return result;
  };
  return elements.map((element) => {
    const { [CUT_MARK]: cutId, ...rest } = element;
    return renew(
      rest as PlaitElement,
      typeof cutId === 'string' && isMove(cutId)
    );
  });
}

// 128-bit non-cryptographic hash (cyrb128); enough to make derived IDs
// distinct, and stable across runs.
function hash128(text: string): number[] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((value) => value >>> 0);
}

/**
 * The replacement ID for a duplicate card: derived from the node, the
 * duplicated ID and an attempt counter, so repairing the same data always
 * gives the same IDs (also after undo/redo). UUID-shaped, version 8.
 */
export function deriveAnkiCardId(
  nodeId: string,
  cardId: string,
  attempt: number
): string {
  const hex = hash128(`anki-card\u0000${nodeId}\u0000${cardId}\u0000${attempt}`)
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(
    13,
    16
  )}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface AnkiCardIdFix {
  /** Plait path of the element whose cards change. */
  path: number[];
  /** The element's stored cards with duplicate IDs replaced. */
  ankiCards: unknown[];
}

/**
 * Finds card IDs that occur more than once in a document (for example in
 * data from older versions or upstream Drawnix, which copy IDs unchanged).
 * The first occurrence in document tree order keeps its ID; later ones get
 * deriveAnkiCardId. Other card fields are kept.
 */
export function findDuplicateAnkiCardIds(
  elements: PlaitElement[]
): AnkiCardIdFix[] {
  const seen = new Set<string>();
  const fixes: AnkiCardIdFix[] = [];
  const walk = (list: PlaitElement[], parent: number[]) => {
    list.forEach((element, index) => {
      const path = [...parent, index];
      const cards: unknown = element?.['ankiCards'];
      if (Array.isArray(cards)) {
        let changed = false;
        const next = cards.map((card) => {
          if (!isStoredAnkiCard(card)) return card;
          if (!seen.has(card.id)) {
            seen.add(card.id);
            return card;
          }
          let attempt = 0;
          let id: string;
          do id = deriveAnkiCardId(String(element.id), card.id, attempt++);
          while (seen.has(id));
          seen.add(id);
          changed = true;
          return { ...card, id };
        });
        if (changed) fixes.push({ path, ankiCards: next });
      }
      if (Array.isArray(element?.children)) walk(element.children, path);
    });
  };
  walk(elements, []);
  return fixes;
}

/** Returns the elements with duplicate card IDs resolved (unchanged when
 * there are none). */
export function normalizeAnkiCardIds(elements: PlaitElement[]): PlaitElement[] {
  const fixes = findDuplicateAnkiCardIds(elements);
  if (!fixes.length) return elements;
  const apply = (
    list: PlaitElement[],
    path: number[],
    ankiCards: unknown[]
  ): PlaitElement[] =>
    list.map((element, index) => {
      if (index !== path[0]) return element;
      return path.length === 1
        ? { ...element, ankiCards }
        : {
            ...element,
            children: apply(element.children ?? [], path.slice(1), ankiCards),
          };
    });
  return fixes.reduce(
    (result, fix) => apply(result, fix.path, fix.ankiCards),
    elements
  );
}
