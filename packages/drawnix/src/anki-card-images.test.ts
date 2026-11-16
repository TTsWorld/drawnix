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
  it('re-encodes small JPEG files, and PNG or WebP files it cannot parse, dropping EXIF', async () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const { value, encode } = codec(400, 300, () => 1);
      const image = await createAnkiCardImage(file(5000, type), value);
      // Drawn at its own size; the stored bytes are the encoder's, not the file's.
      expect(encode).toHaveBeenCalledTimes(1);
      expect(encode.mock.calls[0].slice(1, 4)).toEqual([
        400,
        300,
        type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      ]);
      expect(image).toMatchObject({ width: 400, height: 300 });
      expect(image.mimeType).not.toBe('image/webp');
    }
  });

  it('keeps small GIFs as they are, so they stay animated', async () => {
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

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32be = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const u32le = (n: number) => u32be(n).reverse();
/** A PNG chunk; the CRC is not checked when stripping. */
const pngChunk = (type: string, data: number[] = [1, 2, 3]) => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
const webpChunk = (type: string, data: number[]) => [
  ...ascii(type),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 ? [0] : []),
];
const webpFile = (chunks: number[][]) => {
  const body = chunks.flat();
  return [
    ...ascii('RIFF'),
    ...u32le(4 + body.length),
    ...ascii('WEBP'),
    ...body,
  ];
};
/** Little-endian TIFF with one IFD entry: Orientation. */
const exif = (orientation: number) => [
  ...ascii('II'),
  42,
  0,
  8,
  0,
  0,
  0,
  1,
  0,
  0x12,
  0x01,
  3,
  0,
  1,
  0,
  0,
  0,
  orientation,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Codec that records the stored bytes. */
function storingCodec(width = 400, height = 300) {
  const stored: { bytes?: Uint8Array } = {};
  const { value, encode } = codec(width, height, () => 1);
  value.toDataUrl = async (blob) => {
    stored.bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${blob.type};base64,AA`;
  };
  return { value, encode, stored };
}

describe('metadata of small PNG and WebP files', () => {
  it('removes metadata chunks from a PNG and keeps transparency and animation', async () => {
    const kept = [
      pngChunk('IHDR'),
      pngChunk('acTL'),
      pngChunk('tRNS'),
      pngChunk('fcTL'),
      pngChunk('IDAT'),
      pngChunk('fcTL'),
      pngChunk('fdAT'),
    ];
    const bytes = [
      ...PNG_SIGNATURE,
      ...kept[0],
      ...pngChunk('eXIf', exif(1)),
      ...pngChunk('tEXt', ascii('GPS\u0000here')),
      ...kept.slice(1).flat(),
      ...pngChunk('iTXt'),
      ...pngChunk('tIME'),
      ...pngChunk('IEND', []),
    ];
    const { value, encode, stored } = storingCodec();
    const image = await createAnkiCardImage(
      new File([new Uint8Array(bytes)], 'x', { type: 'image/png' }),
      value
    );
    expect(encode).not.toHaveBeenCalled();
    expect(image).toMatchObject({
      mimeType: 'image/png',
      width: 400,
      height: 300,
    });
    expect(Array.from(stored.bytes ?? [])).toEqual([
      ...PNG_SIGNATURE,
      ...kept.flat(),
      ...pngChunk('IEND', []),
    ]);
  });

  it('removes EXIF and XMP from an animated WebP and keeps its frames', async () => {
    // VP8X flags: alpha, EXIF, XMP and animation.
    const vp8x = (flags: number) =>
      webpChunk('VP8X', [flags, 0, 0, 0, 9, 0, 0, 9, 0, 0]);
    const anim = webpChunk('ANIM', [0, 0, 0, 0, 0, 0]);
    const frames = [
      webpChunk('ANMF', [1, 2, 3]),
      webpChunk('ANMF', [4, 5, 6, 7]),
    ];
    const bytes = webpFile([
      vp8x(0x10 | 0x08 | 0x04 | 0x02),
      anim,
      ...frames,
      webpChunk('EXIF', exif(1)),
      webpChunk('XMP ', ascii('<x:xmpmeta/>')),
    ]);
    const { value, encode, stored } = storingCodec();
    const image = await createAnkiCardImage(
      new File([new Uint8Array(bytes)], 'x', { type: 'image/webp' }),
      value
    );
    expect(encode).not.toHaveBeenCalled();
    expect(image.mimeType).toBe('image/webp');
    expect(Array.from(stored.bytes ?? [])).toEqual(
      webpFile([vp8x(0x10 | 0x02), anim, ...frames])
    );
  });

  it('re-encodes a small PNG whose EXIF rotates it, as the decoder shows it', async () => {
    const bytes = [
      ...PNG_SIGNATURE,
      ...pngChunk('IHDR'),
      ...pngChunk('eXIf', exif(6)),
      ...pngChunk('IDAT'),
      ...pngChunk('IEND', []),
    ];
    const { value, encode } = storingCodec();
    await createAnkiCardImage(
      new File([new Uint8Array(bytes)], 'x', { type: 'image/png' }),
      value
    );
    expect(encode).toHaveBeenCalledTimes(1);
  });
});

describe('transparent images that are re-encoded', () => {
  it('keeps transparency with WebP when PNG is too large, instead of JPEG on white', async () => {
    const { value, encode } = codec(400, 300, (type) =>
      type === 'image/webp' ? 1000 : ANKI_IMAGE_MAX_BYTES + 1
    );
    value.hasTransparency = () => true;
    const image = await createAnkiCardImage(file(5000), value);
    expect(image).toMatchObject({
      mimeType: 'image/webp',
      width: 400,
      height: 300,
    });
    expect(encode.mock.calls.map((call) => call[3])).toEqual([
      'image/png',
      'image/webp',
    ]);
  });

  it('uses JPEG only after transparent formats failed at every size', async () => {
    // Like a browser without a WebP encoder: it returns PNG.
    const encode = vi.fn(
      async (_i: unknown, _w: number, _h: number, type: string) =>
        type === 'image/jpeg'
          ? new Blob([new Uint8Array(10)], { type })
          : new Blob([new Uint8Array(ANKI_IMAGE_MAX_BYTES + 1)], {
              type: 'image/png',
            })
    );
    const image = await createAnkiCardImage(file(ANKI_IMAGE_MAX_BYTES + 1), {
      ...codec(3000, 3000, () => 1).value,
      encode,
      hasTransparency: () => true,
    });
    expect(image).toMatchObject({ mimeType: 'image/jpeg', width: 1280 });
    // PNG and two WebP tries at 1280, 960 and 640, then JPEG.
    expect(encode).toHaveBeenCalledTimes(10);
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
