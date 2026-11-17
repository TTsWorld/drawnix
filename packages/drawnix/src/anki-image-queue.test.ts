// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createTestingBoard } from '@plait/core';
import {
  setPendingAnkiCardImageQueue,
  waitForPendingAnkiCardImages,
} from './anki-image-queue';

describe('waitForPendingAnkiCardImages', () => {
  it('returns idle when no queue is registered', async () => {
    const board = createTestingBoard([], []);
    await expect(waitForPendingAnkiCardImages(board, 20)).resolves.toBe('idle');
  });

  it('returns idle once the pending batch settles', async () => {
    const board = createTestingBoard([], []);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPendingAnkiCardImageQueue(board, () => pending);
    const waiting = waitForPendingAnkiCardImages(board, 200);
    release();
    await expect(waiting).resolves.toBe('idle');
  });

  it('returns timeout when the bound elapses before the batch settles', async () => {
    const board = createTestingBoard([], []);
    setPendingAnkiCardImageQueue(
      board,
      () =>
        new Promise(() => {
          /* never settles */
        })
    );
    await expect(waitForPendingAnkiCardImages(board, 20)).resolves.toBe(
      'timeout'
    );
  });
});
