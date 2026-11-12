// Test harness for node widgets: a real Plait board with history and fake
// layout references, rendered with react-board's asynchronous notification.
import React, { useEffect, useState } from 'react';
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { BoardContext } from '@plait-board/react-board';
import {
  createTestingBoard,
  fakeNodeWeakMap,
  findElements,
  ListRender,
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

/**
 * Callers must mock `toHostPointFromViewBoxPoint` and
 * `toScreenPointFromHostPoint` from '@plait/core' (jsdom has no screen
 * coordinates) and stub `localStorage` and `ResizeObserver`.
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
          <I18nProvider>{children}</I18nProvider>
        </DrawnixContext.Provider>
      </BoardContext.Provider>
    );
  }

  await act(async () => {
    render(<Harness />);
  });
  return { board, editor, id, appState: state };
}
