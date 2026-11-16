// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeNodeWeakMap,
  PlaitBoard,
  PlaitHistoryBoard,
  type PlaitElement,
  Transforms,
  WritableClipboardOperationType,
} from '@plait/core';
import { createMindmapDocument } from '../editor';
import { renderMindmapWidgets } from '../testing/mindmap-widget-harness';
import {
  DOCUMENT_SIZE_CHECK_DELAY,
  DocumentSizeNotice,
} from './document-size-notice';
import { withDocumentSizeLimit } from '../plugins/with-document-size-limit';

vi.mock('@plait/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/core')>()),
  toHostPointFromViewBoxPoint: (_board: PlaitBoard, point: number[]) => point,
  toScreenPointFromHostPoint: (_board: PlaitBoard, point: number[]) => point,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MiB = 1024 * 1024;

async function setup() {
  const document = createMindmapDocument('# Root\n## Child');
  const result = await renderMindmapWidgets(
    document.elements,
    () => ({}),
    <DocumentSizeNotice />
  );
  const { board } = result;
  // Plait would place the pasted elements on the board.
  const inserted = vi.fn((data: { elements?: PlaitElement[] } | null) => {
    for (const element of data?.elements ?? []) {
      Transforms.insertNode(board, element, [board.children.length]);
    }
  });
  board.insertFragment = inserted;
  withDocumentSizeLimit(board);
  return { ...result, inserted };
}

async function waitForCheck() {
  await act(async () => {
    vi.advanceTimersByTime(DOCUMENT_SIZE_CHECK_DELAY);
  });
}

/** A change that does not go through paste: Agent command, redo, image. */
async function setNote(board: PlaitBoard, note: string) {
  await act(async () => {
    fakeNodeWeakMap(board);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { note }, [0]);
    });
  });
}

function paste(board: PlaitBoard, bytes: number) {
  const element = {
    ...(createMindmapDocument('# Pasted').elements[0] as PlaitElement),
    note: 'x'.repeat(bytes),
  };
  board.insertFragment(
    { elements: [element] },
    [0, 0],
    WritableClipboardOperationType.paste
  );
}

describe('document size limit', () => {
  it('shows nothing for a small document', async () => {
    await setup();
    await waitForCheck();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a paste or duplicate that would go over 8 MiB and says why', async () => {
    const { board, inserted } = await setup();
    await setNote(board, 'x'.repeat(5 * MiB));
    await waitForCheck();
    await act(async () => paste(board, 1 * MiB));
    expect(board.children).toHaveLength(2);
    const undos = [...board.history.undos];
    await act(async () => paste(board, 3 * MiB));
    expect(inserted).toHaveBeenCalledTimes(2);
    // Rolled back: the document and its history are as before the paste.
    expect(board.children).toHaveLength(2);
    expect(board.history.undos).toEqual(undos);
    expect(screen.getByRole('alert').textContent).toMatch(
      /^未粘贴：粘贴后文档约 9\.0 MiB/
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a document over the limit after changes that are not pastes', async () => {
    const { board } = await setup();
    await setNote(board, 'x'.repeat(6.5 * MiB));
    await waitForCheck();
    expect(screen.getByRole('status').textContent).toMatch(
      /^文档已较大（约 6\.5 MiB）/
    );
    await setNote(board, 'x'.repeat(8.5 * MiB));
    await waitForCheck();
    expect(screen.getByRole('alert').textContent).toMatch(
      /^文档约 8\.5 MiB，超过 8 MiB 上限/
    );
    // Dismissed until the level changes.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => board.undo());
    await waitForCheck();
    expect(screen.getByRole('status').textContent).toMatch(/^文档已较大/);
  });
});
