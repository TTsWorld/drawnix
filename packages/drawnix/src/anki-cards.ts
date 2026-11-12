import type { PlaitElement } from '@plait/core';
import { MindElement, PlaitMind } from '@plait/mind';
import { Node } from 'slate';

/**
 * An Anki card attached to a mind-map node, stored at `MindElement.ankiCards`.
 * Like notes it lives outside `data`, because Plait rebuilds `data` in some
 * transforms (for example when removing an emoji).
 *
 * `front` and `back` are plain multiline text; exporters convert them to
 * Anki's HTML fields. `id` is stable for the life of the card so that repeated
 * exports can use it as the Anki note GUID.
 */
export interface MindmapAnkiCard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
}

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

/** Reads a node's cards, ignoring malformed entries from external edits. */
export function getAnkiCards(element: PlaitElement | undefined): MindmapAnkiCard[] {
  const value = element?.['ankiCards'];
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (card): card is Record<string, unknown> =>
        !!card &&
        typeof card === 'object' &&
        typeof card.id === 'string' &&
        !!card.id
    )
    .map((card) => {
      const tags = Array.isArray(card.tags)
        ? card.tags.filter(
            (tag): tag is string => typeof tag === 'string' && !!tag
          )
        : [];
      return {
        id: card.id as string,
        front: typeof card.front === 'string' ? card.front : '',
        back: typeof card.back === 'string' ? card.back : '',
        ...(tags.length ? { tags } : {}),
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

/**
 * Gives pasted cards new IDs when their IDs are already on the board, so a
 * copy never shares an Anki GUID with its source. A cut-and-paste keeps IDs
 * because the source has already been removed.
 */
export function renewDuplicateAnkiCardIds(
  elements: PlaitElement[],
  existing: PlaitElement[]
): PlaitElement[] {
  const used = collectAnkiCardIds(existing, new Set());
  const renew = (element: PlaitElement): PlaitElement => {
    let result = element;
    if (Array.isArray(element['ankiCards'])) {
      const cards = getAnkiCards(element).map((card) => {
        const id = used.has(card.id) ? createAnkiCardId() : card.id;
        used.add(id);
        return { ...card, id };
      });
      const { ankiCards: _ankiCards, ...rest } = element;
      result = (cards.length ? { ...rest, ankiCards: cards } : rest) as PlaitElement;
    }
    if (Array.isArray(element.children)) {
      result = { ...result, children: element.children.map(renew) };
    }
    return result;
  };
  return elements.map(renew);
}
