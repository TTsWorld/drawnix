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
  it('opens the save picker before awaiting images, then serializes after they settle', async () => {
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

    const { saveAsJSON } = await import('./json');
    const { fileSave } = await import('./filesystem');
    vi.mocked(fileSave).mockClear();
    vi.mocked(fileSave).mockImplementation(async (blob) => {
      // Picker path runs with a Promise<Blob> while images are still pending.
      expect(blob).toBeInstanceOf(Promise);
      expect(committed).toBe(false);
      release();
      const resolved = await blob;
      expect(committed).toBe(true);
      expect(resolved).toBeInstanceOf(Blob);
      expect(serializeAsJSON(board)).toContain('data:image/jpeg;base64,QQ');
      return null;
    });

    await saveAsJSON(board, 'pending');
    expect(fileSave).toHaveBeenCalledOnce();
  });

  it('awaits the image queue before a serialized snapshot is taken', async () => {
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
  });

  it('opens the open picker before awaiting images', async () => {
    const board = createTestingBoard([], []);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const queue: Promise<unknown> = pending.then(() => {
      settled = true;
    });
    setPendingAnkiCardImageQueue(board, () => queue);

    const { loadFromJSON } = await import('./json');
    const { fileOpen } = await import('./filesystem');
    const order: string[] = [];
    vi.mocked(fileOpen).mockImplementation(async () => {
      order.push('picker');
      expect(settled).toBe(false);
      // Release after the picker opens so the post-picker wait can finish.
      queueMicrotask(() => {
        release();
        order.push('released');
      });
      return new File(['{}'], 'empty.drawnix', {
        type: 'application/vnd.drawnix+json',
      });
    });

    // loadFromBlob will reject invalid content; we only care about picker-then-wait order.
    await expect(loadFromJSON(board)).rejects.toThrow();
    expect(order[0]).toBe('picker');
    expect(settled).toBe(true);
    expect(order).toContain('released');
  });
});

