// Document commands adapted from build-my-work/stair (Apache-2.0).
// See LICENSES/stair-Apache-2.0.txt.
import {
  fakeNodeWeakMap,
  Path,
  PlaitHistoryBoard,
  PlaitNode,
  PlaitOperation,
  Transforms,
  PlaitBoard,
  type PlaitElement,
  type PlaitTheme,
  type Viewport,
} from '@plait/core';
import { buildText } from '@plait/common';
import {
  createMindElement,
  findNewChildNodePath,
  insertElementHandleAbstract,
  insertElementHandleRightNodeCount,
  isInRightBranchOfStandardLayout,
  MindElement,
  MindTransforms,
  PlaitMind,
  type PlaitMindBoard,
} from '@plait/mind';
import { Node, type Element as SlateElement } from 'slate';
import { parseMarkdownToDrawnix } from '@plait-board/markdown-to-drawnix';
import { getMindmapAnkiCards, type MindmapAnkiCardNode } from './anki-cards';
import { findElementById } from './mind-tree';

export {
  getMindmapAnkiCards,
  type MindmapAnkiCard,
  type MindmapAnkiCardImage,
  type MindmapAnkiCardMedia,
  type MindmapAnkiCardSide,
  type MindmapAnkiCardNode,
} from './anki-cards';

export interface DrawnixDocument {
  type: 'drawnix';
  version: number;
  source: 'web';
  elements: PlaitElement[];
  viewport: Viewport;
  theme?: PlaitTheme;
}

export interface MindmapNode {
  id: string;
  topic: string;
  note?: string;
  children: MindmapNode[];
}

export type MindmapOperation =
  | { type: 'populate_empty'; markdown: string }
  | { type: 'insert_child'; parentId: string; topic: string }
  | { type: 'insert_sibling'; nodeId: string; topic: string }
  | { type: 'set_topic'; nodeId: string; topic: string }
  | { type: 'set_note'; nodeId: string; note: string };

/** Hosts own persistence and authorization; editor commands own document history. */
export interface DrawnixEditor {
  serialize(): string;
  readMindmap(): MindmapNode[];
  updateMindmap(operations: MindmapOperation[]): void;
  /** Every node with Anki cards, depth-first in document order. */
  readAnkiCards(): MindmapAnkiCardNode[];
}

export function createDrawnixEditor(board: PlaitBoard): DrawnixEditor {
  return {
    serialize: () => serializeDrawnixBoard(board),
    readMindmap: () => getMindmapOutline(board.children),
    updateMindmap: (operations) => applyMindmapOperations(board, operations),
    readAnkiCards: () => getMindmapAnkiCards(board.children),
  };
}

function mindmapError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function parseDrawnixDocument(content: string): DrawnixDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw mindmapError(
      'MINDMAP_INVALID_DOCUMENT',
      'The document is not valid Drawnix JSON.'
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw mindmapError(
      'MINDMAP_INVALID_DOCUMENT',
      'The document is not a native Drawnix document.'
    );
  }

  const value = parsed as Partial<DrawnixDocument>;
  const zoom =
    value.viewport && typeof value.viewport === 'object'
      ? (value.viewport as { zoom?: unknown }).zoom
      : undefined;
  if (
    value.type !== 'drawnix' ||
    typeof value.version !== 'number' ||
    value.source !== 'web' ||
    !Array.isArray(value.elements) ||
    typeof zoom !== 'number' ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    throw mindmapError(
      'MINDMAP_INVALID_DOCUMENT',
      'The document is not a native Drawnix document.'
    );
  }
  const invalid = findInvalidElement(value.elements as unknown[], false);
  if (invalid) {
    throw mindmapError(
      'MINDMAP_INVALID_DOCUMENT',
      `The document has an invalid element: ${invalid}.`
    );
  }
  return value as DrawnixDocument;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A Slate node: text, or an element whose children are Slate nodes. */
function isSlateNode(value: unknown, depth = 0): boolean {
  if (!isObject(value) || depth > 32) return false;
  if (typeof value.text === 'string') return true;
  return (
    Array.isArray(value.children) &&
    value.children.every((child) => isSlateNode(child, depth + 1))
  );
}

/**
 * Checks what readers and Plait rely on: every element is an object with a
 * string ID; children are arrays; mind-map nodes (roots and anything Plait
 * treats as a mind element inside them) have a Slate topic. Returns a short
 * description of the first problem, or null.
 */
function findInvalidElement(elements: unknown[], inMind: boolean): string | null {
  for (const element of elements) {
    if (!isObject(element)) return 'not an object';
    if (typeof element.id !== 'string' || !element.id) return 'missing id';
    const isMindNode =
      element.type === 'mindmap' ||
      element.type === 'mind_child' ||
      (inMind && isObject(element.data) && !!element.data.topic);
    if (isMindNode) {
      if (!isObject(element.data) || !isSlateNode(element.data.topic)) {
        return `mind-map node ${element.id} has no valid topic`;
      }
    }
    if (element.children !== undefined) {
      if (!Array.isArray(element.children)) {
        return `children of ${element.id} are not a list`;
      }
      const problem = findInvalidElement(
        element.children,
        inMind || isMindNode
      );
      if (problem) return problem;
    }
  }
  return null;
}

export function serializeDrawnixBoard(board: PlaitBoard): string {
  return JSON.stringify(
    {
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements: board.children,
      viewport: board.viewport,
      theme: board.theme,
    },
    null,
    2
  );
}

export function mindElementToOutlineNode(element: MindElement): MindmapNode {
  return {
    id: element.id,
    topic: Node.string(element.data.topic),
    ...(typeof element.note === 'string' && element.note
      ? { note: element.note }
      : {}),
    children: element.children
      .filter((child) => MindElement.isMindElement(null, child))
      .map(mindElementToOutlineNode),
  };
}

export function getMindmapOutline(elements: PlaitElement[]): MindmapNode[] {
  return elements.filter(PlaitMind.isMind).map(mindElementToOutlineNode);
}

function requireMindElement(board: PlaitBoard, id: string): MindElement {
  // Also inside collapsed branches: readMindmap() lists those nodes too.
  const element = findElementById(board.children, id);
  if (!element || !MindElement.isMindElement(board, element)) {
    throw mindmapError(
      'MINDMAP_NODE_NOT_FOUND',
      `Mind-map node ${id} is not present on the open board.`
    );
  }
  return element;
}

const OPERATION_FIELDS: Record<MindmapOperation['type'], string[]> = {
  populate_empty: ['markdown'],
  insert_child: ['parentId', 'topic'],
  insert_sibling: ['nodeId', 'topic'],
  set_topic: ['nodeId', 'topic'],
  set_note: ['nodeId', 'note'],
};

/** Operations usually come from Agent JSON: check types before use. */
function validateOperationShapes(operations: unknown): void {
  if (!Array.isArray(operations)) {
    throw mindmapError(
      'MINDMAP_INVALID_OPERATION',
      'Mind-map operations must be a list.'
    );
  }
  for (const operation of operations) {
    const type = isObject(operation) ? operation.type : undefined;
    const fields =
      typeof type === 'string' &&
      Object.prototype.hasOwnProperty.call(OPERATION_FIELDS, type)
        ? OPERATION_FIELDS[type as MindmapOperation['type']]
        : null;
    if (!fields) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        `Unknown mind-map operation type: ${String(type)}.`
      );
    }
    for (const field of fields) {
      if (typeof (operation as Record<string, unknown>)[field] !== 'string') {
        throw mindmapError(
          'MINDMAP_INVALID_OPERATION',
          `${String(type)} needs a text ${field}.`
        );
      }
    }
  }
}

function validateIncrementalOperations(
  board: PlaitBoard,
  operations: MindmapOperation[]
): void {
  for (const operation of operations) {
    if (operation.type === 'populate_empty') continue;
    const id =
      operation.type === 'insert_child' ? operation.parentId : operation.nodeId;
    const element = requireMindElement(board, id);
    if (operation.type === 'insert_sibling' && PlaitMind.isMind(element)) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        'A root mind-map node cannot have a sibling.'
      );
    }
    // Summary nodes are mind elements with a start and end (AbstractNode).
    if (
      operation.type === 'insert_sibling' &&
      typeof element['start'] === 'number' &&
      typeof element['end'] === 'number'
    ) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        'A summary node cannot have a sibling.'
      );
    }
    if (operation.type !== 'set_note' && !operation.topic.trim()) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        'Mind-map topics cannot be empty.'
      );
    }
  }
}

export function createMindmapDocument(markdown: string): DrawnixDocument {
  const trimmedMarkdown = markdown.trim();
  if (!trimmedMarkdown) {
    throw mindmapError(
      'MINDMAP_INVALID_OPERATION',
      'A root topic is required.'
    );
  }
  const lines = trimmedMarkdown.split(/\r?\n/);
  const heading = /^\s{0,3}(#{1,6})\s+\S/;
  // A first line that is not a heading is the root topic, also when headings
  // follow: `Root\n## A` puts A under Root.
  if (!heading.test(lines[0])) {
    const first = lines[0].trim();
    const rootTopic =
      first.match(/^(?:[-+*]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? first;
    if (
      !rootTopic ||
      rootTopic.startsWith('```') ||
      rootTopic.startsWith('~~~') ||
      rootTopic.startsWith('>')
    ) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        'Markdown must begin with a root topic or heading.'
      );
    }
    lines[0] = `# ${rootTopic}`;
    // Headings that follow go below the root: `#` becomes `##`.
    if (lines.slice(1).some((line) => heading.exec(line)?.[1] === '#')) {
      let fence = false;
      for (let i = 1; i < lines.length; i++) {
        if (/^\s{0,3}(```|~~~)/.test(lines[i])) fence = !fence;
        const level = !fence && heading.exec(lines[i])?.[1];
        if (level && level.length < 6) {
          lines[i] = lines[i].replace('#', '##');
        }
      }
    }
  }

  let mind: MindElement;
  try {
    mind = parseMarkdownToDrawnix(lines.join('\n'));
  } catch {
    throw mindmapError(
      'MINDMAP_INVALID_OPERATION',
      'Drawnix could not parse the Markdown hierarchy.'
    );
  }
  mind.points = [[100, 100]];
  return {
    type: 'drawnix',
    version: 1,
    source: 'web',
    elements: [mind],
    viewport: { zoom: 1 },
  };
}

export function applyMindmapOperations(
  board: PlaitBoard,
  operations: MindmapOperation[]
): void {
  validateOperationShapes(operations);
  if (operations.length < 1 || operations.length > 50) {
    throw mindmapError(
      'MINDMAP_INVALID_OPERATION',
      'Provide between 1 and 50 mind-map operations.'
    );
  }

  let mutate: () => void;
  const populate = operations.find(
    (operation) => operation.type === 'populate_empty'
  );
  if (populate?.type === 'populate_empty') {
    if (operations.length !== 1 || board.children.length !== 0) {
      throw mindmapError(
        'MINDMAP_NOT_EMPTY',
        'populate_empty can only be used by itself on a completely empty board.'
      );
    }
    if (!populate.markdown.trim()) {
      throw mindmapError(
        'MINDMAP_INVALID_OPERATION',
        'Markdown used to populate a mind map cannot be empty.'
      );
    }
    const mind = createMindmapDocument(populate.markdown)
      .elements[0] as MindElement;
    mutate = () => {
      MindTransforms.insertMind(board as PlaitMindBoard, mind);
    };
  } else {
    validateIncrementalOperations(board, operations);
    mutate = () => {
      for (const operation of operations) {
        if (operation.type === 'populate_empty') continue;
        fakeNodeWeakMap(board);
        const element = requireMindElement(
          board,
          operation.type === 'insert_child'
            ? operation.parentId
            : operation.nodeId
        );
        if (operation.type === 'set_note') {
          // Keep metadata outside data: Plait rebuilds data when removing emojis.
          Transforms.setNode(
            board,
            { note: operation.note || undefined },
            PlaitBoard.findPath(board, element)
          );
          continue;
        }
        if (operation.type === 'set_topic') {
          MindTransforms.setTopic(
            board as PlaitMindBoard,
            element,
            buildText(operation.topic) as SlateElement
          );
          continue;
        }

        let path: number[];
        if (operation.type === 'insert_child') {
          // Like MindTransforms.insertChildNode, expand a collapsed parent
          // so the new child shows. Unlike it, the expansion is part of the
          // batch: one undo removes the child and collapses the parent again.
          if (element.isCollapsed) {
            Transforms.setNode(
              board,
              { isCollapsed: false },
              PlaitBoard.findPath(board, element)
            );
          }
          path = findNewChildNodePath(board, element);
        } else {
          // Like MindTransforms.insertSiblingNode, without selecting the new
          // node or starting topic editing: a summary covering the node also
          // covers the new sibling, and a sibling on the right side of a
          // standard layout stays on the right.
          const nodePath = PlaitBoard.findPath(board, element);
          path = Path.next(nodePath);
          if (isInRightBranchOfStandardLayout(element)) {
            MindTransforms.setRightNodeCountByRefs(
              board,
              insertElementHandleRightNodeCount(board, nodePath.slice(0, 1), 1)
            );
          }
          MindTransforms.setAbstractsByRefs(
            board,
            insertElementHandleAbstract(board, path)
          );
        }
        MindTransforms.insertNodes(
          board,
          [createMindElement(operation.topic, {})],
          path
        );
        if (!MindElement.isMindElement(board, PlaitNode.get(board, path))) {
          throw mindmapError(
            'MINDMAP_UPDATE_FAILED',
            'Drawnix did not insert the requested mind-map node.'
          );
        }
      }
    };
  }

  // Roll back by the operations this batch actually applied. Comparing undo
  // stack lengths is not enough: Plait keeps 100 batches and drops the oldest
  // when a new one is added. The saved history is restored as it was.
  const { history } = board;
  const undos = [...history.undos];
  const redos = [...history.redos];
  const applied: PlaitOperation[] = [];
  const { apply } = board;
  board.apply = (operation) => {
    apply(operation);
    applied.push(operation);
  };
  let mutationFailed = false;
  let mutationError: unknown;
  try {
    PlaitHistoryBoard.withNewBatch(board, () => {
      try {
        mutate();
      } catch (error) {
        mutationFailed = true;
        mutationError = error;
      }
    });
  } finally {
    board.apply = apply;
  }
  if (!mutationFailed) return;

  PlaitHistoryBoard.withoutSaving(board, () => {
    for (const operation of applied.map(PlaitOperation.inverse).reverse()) {
      board.apply(operation);
    }
  });
  history.undos = undos;
  history.redos = redos;
  throw mutationError;
}
