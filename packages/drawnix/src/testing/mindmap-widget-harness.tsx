// Test harness for node widgets: a real Plait board with history and fake
// layout references, rendered with react-board's asynchronous notification.
import React, { useEffect, useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardContext } from '@plait-board/react-board';
import {
  addSelectedElement,
  clearSelectedElement,
  createTestingBoard,
  fakeNodeWeakMap,
  findElements,
  ListRender,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
  PlaitBoard,
  type PlaitElement,
  PlaitPointerType,
  withHistory,
} from '@plait/core';
import {
  getRectangleByNode,
  MIND_ELEMENT_TO_NODE,
  MindElement,
  type MindNode,
} from '@plait/mind';
import { createDrawnixEditor } from '../editor';
import { DrawnixContext, type DrawnixState } from '../hooks/use-drawnix';
import { I18nProvider } from '../i18n';
import { MindmapNodeActions } from '../components/mindmap-node-actions';

/**
 * Callers must mock `toHostPointFromViewBoxPoint` and
 * `toScreenPointFromHostPoint` from '@plait/core' (jsdom has no screen
 * coordinates) and stub `ResizeObserver`.
 */
export async function renderMindmapWidgets(
  elements: PlaitElement[],
  initialState: (rootId: string) => Partial<DrawnixState>,
  children: React.ReactNode
) {
  const board = createTestingBoard([withHistory], elements);
  // ListRender refreshes layout references in onChange, before the React
  // context notification in afterChange. New node objects have no layout yet.
  board.onChange = () => {
    fakeNodeWeakMap(board);
    const elements = findElements(board, {
      match: (element) => MindElement.isMindElement(board, element),
      recursion: () => true,
    }) as MindElement[];
    for (const element of elements) {
      MIND_ELEMENT_TO_NODE.set(element, {
        origin: element,
        x: 100,
        y: 100,
        width: 100,
        height: 40,
        hGap: 0,
        vGap: 0,
      } as MindNode);
    }
  };
  board.onChange();
  board.getRectangle = (element) =>
    getRectangleByNode(MindElement.getNode(element as MindElement));
  const editor = createDrawnixEditor(board);
  const id = editor.readMindmap()[0].id;
  const host = window.document.createElement('div');
  host.className = 'drawnix';
  vi.spyOn(PlaitBoard, 'getBoardContainer').mockReturnValue(host);
  const state: { current?: DrawnixState } = {};

  function Harness() {
    const [context, setContext] = useState({
      v: 0,
      board,
      listRender: new ListRender(board),
    });
    const [appState, setAppState] = useState<DrawnixState>({
      pointer: PlaitPointerType.selection,
      isMobile: false,
      isPencilMode: false,
      openDialogType: null,
      openCleanConfirm: false,
      ...initialState(id),
    });
    state.current = appState;
    useEffect(() => {
      // Match react-board's asynchronous notification after a Plait operation.
      board.afterChange = () => {
        setContext((value) => ({ ...value, v: value.v + 1 }));
      };
    }, []);
    return (
      <BoardContext.Provider value={context}>
        <DrawnixContext.Provider value={{ appState, setAppState }}>
          <I18nProvider>
            <MindmapNodeActions />
            {children}
          </I18nProvider>
        </DrawnixContext.Provider>
      </BoardContext.Provider>
    );
  }

  await act(async () => {
    render(<Harness />);
  });
  return { board, editor, id, appState: state };
}

/**
 * Like Plait's ListRender, which does not render the children of a collapsed
 * node: from now on, nodes inside a collapsed branch have no render path, so
 * `PlaitBoard.findPath` cannot find them.
 */
export function keepRenderPathsForShownNodesOnly(board: PlaitBoard) {
  const onChange = board.onChange;
  const forget = (elements: PlaitElement[]) => {
    for (const element of elements) {
      NODE_TO_INDEX.delete(element);
      NODE_TO_PARENT.delete(element);
      forget(element.children ?? []);
    }
  };
  const visit = (elements: PlaitElement[]) => {
    for (const element of elements) {
      if (element.isCollapsed) forget(element.children ?? []);
      else visit(element.children ?? []);
    }
  };
  board.onChange = () => {
    onChange();
    visit(board.children);
  };
  board.onChange();
}

/** Selects one node, which shows its action buttons, as a click on it would. */
export async function selectMindNode(board: PlaitBoard, id: string) {
  await act(async () => {
    const element = findElements(board, {
      match: (value) => value.id === id,
      recursion: () => true,
    })[0];
    clearSelectedElement(board);
    addSelectedElement(board, element);
    // react-board renders again after a selection change.
    board.afterChange();
  });
}

/** The action bar of the node with this topic. */
export const nodeActions = (topic: string) =>
  screen.getByRole('toolbar', { name: `节点操作: ${topic}` });

/** A button in the action bar of the node with this topic. */
export const nodeAction = (topic: string, name: string | RegExp) =>
  within(nodeActions(topic)).getByRole('button', { name });
