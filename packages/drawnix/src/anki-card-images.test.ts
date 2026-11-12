import { describe, expect, it, vi } from 'vitest';
import {
  ANKI_IMAGE_MAX_BYTES,
  type AnkiImageCodec,
  AnkiImageError,
  checkDocumentBudget,
  createAnkiCardImage,
  DOCUMENT_SIZE_MAX_AFTER_ADD,
  getImageFiles,
} from './anki-card-images';

const file = (size: number, type = 'image/png') =>
  new File([new Uint8Array(size)], 'x', { type });

function codec(
  width: number,
  height: number,
  sizeOf: (type: string, quality: number | undefined, edge: number) => number
) {
  const encode = vi.fn(
    async (_i: unknown, w: number, h: number, type: string, q?: number) =>
      new Blob([new Uint8Array(sizeOf(type, q, Math.max(w, h)))], { type })
  );
  const value: AnkiImageCodec = {
    decode: async () => ({ width, height, source: {} as never }),
    encode,
    toDataUrl: async (blob) => `data:${blob.type};base64,AA`,
  };
  return { value, encode };
}

describe('card image compression', () => {
  it('keeps small images as they are (GIF animation survives)', async () => {
    const { value, encode } = codec(400, 300, () => 1);
    const image = await createAnkiCardImage(file(5000, 'image/gif'), value);
    expect(encode).not.toHaveBeenCalled();
    expect(image).toMatchObject({
      mimeType: 'image/gif',
      width: 400,
      height: 300,
      url: 'data:image/gif;base64,AA',
    });
  });

  it('scales large images to 1280px and prefers PNG when it fits', async () => {
    const { value, encode } = codec(4000, 2000, () => 1000);
    const image = await createAnkiCardImage(file(10), value);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({
      mimeType: 'image/png',
      width: 1280,
      height: 640,
    });
  });

  it('falls back to JPEG, then smaller sizes, until the image fits', async () => {
    const { value, encode } = codec(3000, 3000, (type, quality, edge) =>
      type === 'image/jpeg' && quality === 0.55 && edge === 960
        ? ANKI_IMAGE_MAX_BYTES
        : ANKI_IMAGE_MAX_BYTES + 1
    );
    const image = await createAnkiCardImage(
      file(ANKI_IMAGE_MAX_BYTES + 1),
      value
    );
    expect(image).toMatchObject({
      mimeType: 'image/jpeg',
      width: 960,
      height: 960,
    });
    expect(encode).toHaveBeenCalledTimes(8);
  });

  it('reports unsupported, unreadable and too large images', async () => {
    const huge = codec(3000, 3000, () => ANKI_IMAGE_MAX_BYTES + 1).value;
    const code = (promise: Promise<unknown>) =>
      promise.then(
        () => 'ok',
        (error) => (error instanceof AnkiImageError ? error.code : 'other')
      );
    expect(
      await code(createAnkiCardImage(file(1, 'image/svg+xml'), huge))
    ).toBe('unsupported');
    expect(
      await code(
        createAnkiCardImage(file(1), {
          ...huge,
          decode: () => Promise.reject(new Error('bad')),
        })
      )
    ).toBe('unreadable');
    expect(await code(createAnkiCardImage(file(1), huge))).toBe('too-large');
  });
});

describe('document size budget', () => {
  it('accepts additions below the limit and rejects ones above it', () => {
    expect(checkDocumentBudget(1000, ['data:image/png;base64,AAAA'])).toBe(
      1000 + 26 + 200
    );
    expect(() =>
      checkDocumentBudget(DOCUMENT_SIZE_MAX_AFTER_ADD - 100, ['data:x'])
    ).toThrow(AnkiImageError);
  });
});

describe('clipboard image files', () => {
  it('reads files, falling back to items, and ignores non-images', () => {
    const png = file(1);
    expect(
      getImageFiles({ files: [png, file(1, 'text/plain')] } as never)
    ).toEqual([png]);
    expect(
      getImageFiles({
        files: [],
        items: [{ kind: 'file', getAsFile: () => png }],
      } as never)
    ).toEqual([png]);
    expect(getImageFiles(null)).toEqual([]);
  });
});
