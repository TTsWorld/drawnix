// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestingBoard } from '@plait/core';
import {
  setPendingAnkiCardImageQueue,
  waitForPendingAnkiCardImages,
} from './anki-image-queue';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

  it('returns timeout when a later batch is still pending after the deadline', async () => {
    const board = createTestingBoard([], []);
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>(() => {
      /* never settles */
    });
    let current: Promise<unknown> = first;
    setPendingAnkiCardImageQueue(board, () => current);

    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const waiting = waitForPendingAnkiCardImages(board, 100);
    // Chain a newer batch and expire the bound before the post-settle check.
    current = second;
    now = 1_200;
    releaseFirst();
    await expect(waiting).resolves.toBe('timeout');
  });
});
