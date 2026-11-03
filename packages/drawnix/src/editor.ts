// Document commands adapted from build-my-work/stair (Apache-2.0).
// See LICENSES/stair-Apache-2.0.txt.
import {
  fakeNodeWeakMap,
  findElements,
  PlaitHistoryBoard,
  PlaitNode,
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
  findNewSiblingNodePath,
  MindElement,
  MindTransforms,
  PlaitMind,
  type PlaitMindBoard,
} from '@plait/mind';
import { Node, type Element as SlateElement } from 'slate';
import { parseMarkdownToDrawnix } from '@plait-board/markdown-to-drawnix';

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
}

export function createDrawnixEditor(board: PlaitBoard): DrawnixEditor {
  return {
    serialize: () => serializeDrawnixBoard(board),
    readMindmap: () => getMindmapOutline(board.children),
    updateMindmap: (operations) => applyMindmapOperations(board, operations),
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
  return value as DrawnixDocument;
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
  const element = findElements(board, {
    match: (candidate) => candidate.id === id,
    recursion: () => true,
    isReverse: false,
  })[0];
  if (!element || !MindElement.isMindElement(board, element)) {
    throw mindmapError(
      'MINDMAP_NODE_NOT_FOUND',
      `Mind-map node ${id} is not present on the open board.`
    );
  }
  return element;
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
    if (operation.type === 'set_note') {
      if (typeof operation.note !== 'string') {
        throw mindmapError(
          'MINDMAP_INVALID_OPERATION',
          'Mind-map notes must be text.'
        );
      }
    } else if (!operation.topic.trim()) {
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
  if (!lines.some((line) => /^\s{0,3}#{1,6}\s+\S/.test(line))) {
    const first = lines[0]!.trim();
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

        const path =
          operation.type === 'insert_child'
            ? findNewChildNodePath(board, element)
            : findNewSiblingNodePath(board, element);
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

  const undoCount = board.history.undos.length;
  const previousRedos = [...board.history.redos];
  let mutationFailed = false;
  let mutationError: unknown;
  PlaitHistoryBoard.withNewBatch(board, () => {
    try {
      mutate();
    } catch (error) {
      mutationFailed = true;
      mutationError = error;
    }
  });
  if (!mutationFailed) return;

  while (board.history.undos.length > undoCount) board.undo();
  board.history.redos = previousRedos;
  throw mutationError;
}
