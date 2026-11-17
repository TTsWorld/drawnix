// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTestingBoard } from '@plait/core';
import {
  setPendingAnkiCardImageQueue,
  waitForPendingAnkiCardImages,
} from '../anki-image-queue';
import { serializeAsJSON } from './json';

vi.mock('./filesystem', () => ({
  fileSave: vi.fn(async () => ({ fileHandle: null })),
  fileOpen: vi.fn(),
}));

describe('saveAsJSON pending images', () => {
  it('awaits the image queue before the serialized snapshot is taken', async () => {
    const board = createTestingBoard([], []);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let committed = false;
    const queue: Promise<unknown> = pending.then(() => {
      committed = true;
      board.children = [
        {
          id: 'n1',
          type: 'mindmap',
          points: [[0, 0]],
          data: { topic: { children: [{ text: 'Root' }] } },
          children: [],
          ankiCards: [
            {
              id: 'c1',
              frontImages: [{ url: 'data:image/jpeg;base64,QQ' }],
            },
          ],
        },
      ] as typeof board.children;
    });
    setPendingAnkiCardImageQueue(board, () => queue);

    const waiting = waitForPendingAnkiCardImages(board, 200);
    expect(committed).toBe(false);
    expect(serializeAsJSON(board)).not.toContain('data:image/jpeg;base64,QQ');

    release();
    await expect(waiting).resolves.toBe('idle');
    expect(committed).toBe(true);
    expect(serializeAsJSON(board)).toContain('data:image/jpeg;base64,QQ');

    // Built-in save calls the same wait before serializeAsJSON.
    const { saveAsJSON } = await import('./json');
    const { fileSave } = await import('./filesystem');
    vi.mocked(fileSave).mockClear();
    await saveAsJSON(board, 'pending');
    expect(fileSave).toHaveBeenCalledOnce();
  });
});
