// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTestingBoard } from '@plait/core';
import { setPendingAnkiCardImageQueue } from '../anki-image-queue';

vi.mock('@plait/core', async () => {
  const actual = await vi.importActual<typeof import('@plait/core')>(
    '@plait/core'
  );
  return {
    ...actual,
    getSelectedElements: vi.fn(() => [{ id: 'captured' }]),
    toSvgData: vi.fn(async (_board, options: { elements?: unknown }) => {
      // Export must use the selection captured before the image wait.
      expect(options.elements).toEqual([{ id: 'captured' }]);
      return '<svg></svg>';
    }),
  };
});

vi.mock('./common', async () => {
  const actual = await vi.importActual<typeof import('./common')>('./common');
  return {
    ...actual,
    boardToImage: vi.fn(async (_board, options: { elements?: unknown }) => {
      expect(options.elements).toEqual([{ id: 'captured' }]);
      return 'data:image/png;base64,AA';
    }),
    download: vi.fn(),
    base64ToBlob: vi.fn(() => new Blob(['x'], { type: 'image/png' })),
  };
});

describe('image export selection capture', () => {
  it('captures the selection before awaiting pending card images for SVG export', async () => {
    const board = createTestingBoard([], []);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPendingAnkiCardImageQueue(board, () => pending);

    const { getSelectedElements } = await import('@plait/core');
    const { saveAsSvg } = await import('./image');
    const exporting = saveAsSvg(board);
    // Selection is read synchronously before the wait settles.
    expect(getSelectedElements).toHaveBeenCalled();
    release();
    await exporting;
  });

  it('captures the selection before awaiting pending card images for raster export', async () => {
    const board = createTestingBoard([], []);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPendingAnkiCardImageQueue(board, () => pending);

    const { getSelectedElements } = await import('@plait/core');
    vi.mocked(getSelectedElements).mockClear();
    const { saveAsImage } = await import('./image');
    const exporting = saveAsImage(board, true);
    expect(getSelectedElements).toHaveBeenCalled();
    release();
    await exporting;
  });
});
