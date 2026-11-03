// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardContext } from '@plait-board/react-board';
import {
  BoardTransforms,
  createTestingBoard,
  fakeNodeWeakMap,
  findElements,
  ListRender,
  PlaitBoard,
  PlaitPointerType,
  withHistory,
} from '@plait/core';
import {
  getRectangleByNode,
  MIND_ELEMENT_TO_NODE,
  MindElement,
  type MindNode,
} from '@plait/mind';
import { createDrawnixEditor, createMindmapDocument } from '../editor';
import { DrawnixContext, type DrawnixState } from '../hooks/use-drawnix';
import { I18nProvider } from '../i18n';
import { MindmapNotes } from './mindmap-notes';

// jsdom has no screen coordinates; keep Plait's geometry/reference lookup real.
vi.mock('@plait/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/core')>()),
  toHostPointFromViewBoxPoint: (_board: PlaitBoard, point: number[]) => point,
  toScreenPointFromHostPoint: (_board: PlaitBoard, point: number[]) => point,
}));

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(note = '') {
  const document = createMindmapDocument('# Original\n## Child');
  if (note) document.elements[0].note = note;
  const board = createTestingBoard([withHistory], document.elements);
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
      openNoteId: id,
    });
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
            <MindmapNotes />
          </I18nProvider>
        </DrawnixContext.Provider>
      </BoardContext.Provider>
    );
  }

  await act(async () => {
    render(<Harness />);
  });
  return {
    board,
    editor,
    id,
    input: screen.getByRole('textbox') as HTMLTextAreaElement,
  };
}

describe('mind-map note editing', () => {
  it.each(['copy', 'cut', 'paste'])(
    'keeps %s inside the note without cancelling native text editing',
    async (type) => {
      const { input, editor } = await setup('A note');
      const before = editor.serialize();
      const boardListener = vi.fn((event: Event) => event.preventDefault());
      window.addEventListener(type, boardListener);
      try {
        const event = new Event(type, { bubbles: true, cancelable: true });
        fireEvent(input, event);
        expect(boardListener).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(editor.serialize()).toBe(before);
      } finally {
        window.removeEventListener(type, boardListener);
      }
    }
  );

  it('keeps the caret in the middle while updating the document', async () => {
    const { input, editor } = await setup('abcdef');
    input.setSelectionRange(3, 3);
    fireEvent.input(input, {
      target: { value: 'abcXdef', selectionStart: 4, selectionEnd: 4 },
    });
    expect(input.value).toBe('abcXdef');
    expect(input.selectionStart).toBe(4);
    await act(async () => {
      await Promise.resolve();
    });
    expect(input.selectionStart).toBe(4);
    expect(editor.readMindmap()[0].note).toBe('abcXdef');
    expect(screen.getByRole('textbox')).toBe(input);
  });

  it('refreshes badges after adding, deleting and restoring the first note', async () => {
    const { input, board } = await setup();
    expect(
      screen.queryByRole('button', { name: '打开备注: Original' })
    ).toBeNull();

    fireEvent.input(input, { target: { value: 'First note' } });
    expect(input.value).toBe('First note');
    await act(async () => {
      await Promise.resolve();
    });
    const badge = screen.getByRole('button', { name: '打开备注: Original' });
    expect(badge.style.left).toBe('205px');
    expect(badge.style.top).toBe('92px');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除备注' }));
    });
    expect(
      screen.queryByRole('button', { name: '打开备注: Original' })
    ).toBeNull();
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('First note');
    expect(
      screen.getByRole('button', { name: '打开备注: Original' })
    ).toBeTruthy();
  });

  it('shows loaded notes after the external document fitViewport notification', async () => {
    const { board } = await setup();
    const loaded = createMindmapDocument('# Loaded document');
    loaded.elements[0].note = 'Saved note';
    board.options.hideScrollbar = true;
    vi.spyOn(
      PlaitBoard.getBoardContainer(board),
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, 0, 800, 600));

    await act(async () => {
      // Match Wrapper's value replacement: refresh layout, then fitViewport.
      board.children = loaded.elements;
      board.onChange();
      BoardTransforms.fitViewport(board);
      expect(board.operations.some((op) => op.type === 'set_viewport')).toBe(
        true
      );
    });
    fireEvent.click(
      screen.getByRole('button', { name: '打开备注: Loaded document' })
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Saved note'
    );
  });

  it('undoes a long continuous edit without discarding earlier board history', async () => {
    const { input, editor, id, board } = await setup();
    await act(async () => {
      editor.updateMindmap([
        { type: 'set_topic', nodeId: id, topic: 'Renamed' },
      ]);
    });
    for (let count = 1; count <= 120; count++) {
      await act(async () => {
        fireEvent.input(input, { target: { value: '字'.repeat(count) } });
      });
    }
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('');
    expect(editor.readMindmap()[0].note).toBeUndefined();
    await act(async () => {
      board.undo();
    });
    expect(editor.readMindmap()[0].topic).toBe('Original');
    await act(async () => {
      board.redo();
      board.redo();
    });
    expect(input.value).toBe('字'.repeat(120));
  });

  it('restores the original note after typing and clearing within one edit', async () => {
    const { input, board } = await setup('Original note');
    for (const value of ['Original note plus text', 'New note', '']) {
      await act(async () => {
        fireEvent.input(input, { target: { value } });
      });
    }
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('Original note');
    await act(async () => {
      board.redo();
    });
    expect(input.value).toBe('');
  });

  it('separates edits after blur and preserves undo/redo inside the panel', async () => {
    const { input, editor } = await setup();
    await act(async () => {
      fireEvent.input(input, { target: { value: 'First edit' } });
    });
    fireEvent.blur(input);
    fireEvent.focus(input);
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Second edit' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    });
    expect(input.value).toBe('First edit');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true, shiftKey: true });
    });
    expect(input.value).toBe('Second edit');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'After redo' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    });
    expect(editor.readMindmap()[0].note).toBe('Second edit');
  });

  it('syncs Agent changes and keeps subsequent user input in a separate undo batch', async () => {
    const { input, editor, id, board } = await setup();
    await act(async () => {
      fireEvent.input(input, { target: { value: 'User edit' } });
    });
    await act(async () => {
      editor.updateMindmap([
        { type: 'set_note', nodeId: id, note: 'Agent edit' },
      ]);
    });
    expect(input.value).toBe('Agent edit');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Following user edit' } });
    });
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('Agent edit');
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('User edit');
  });

  it('starts a new edit when switching between node notes', async () => {
    const { input, editor, board } = await setup('Root note');
    const childId = editor.readMindmap()[0].children[0].id;
    await act(async () => {
      editor.updateMindmap([
        { type: 'set_note', nodeId: childId, note: 'Child note' },
      ]);
    });
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Root edit' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开备注: Child' }));
    });
    expect(input.value).toBe('Child note');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Child edit' } });
    });
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('Child note');
    expect(editor.readMindmap()[0].note).toBe('Root edit');
  });

  it('preserves composed text and leaves composition shortcuts to the input', async () => {
    const { input, editor, board } = await setup('ab');
    fireEvent.compositionStart(input);
    fireEvent.input(input, {
      target: { value: 'a你b', selectionStart: 2, selectionEnd: 2 },
      isComposing: true,
    });
    expect(input.value).toBe('a你b');
    expect(input.selectionStart).toBe(2);
    await act(async () => {
      await Promise.resolve();
    });
    const undo = vi.spyOn(board, 'undo');
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, isComposing: true });
    expect(undo).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    expect(editor.readMindmap()[0].note).toBe('a你b');
  });

  it('restores a deleted multiline note through the same history', async () => {
    const { input, editor, board } = await setup('第一行\n第二行');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除备注' }));
    });
    expect(input.value).toBe('');
    expect(editor.readMindmap()[0].note).toBeUndefined();
    await act(async () => {
      board.undo();
    });
    expect(input.value).toBe('第一行\n第二行');
  });
});
