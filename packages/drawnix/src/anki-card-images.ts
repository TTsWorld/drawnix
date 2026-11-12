// Adding images to Anki cards: decoding, downscaling, re-encoding and the
// document size budget. Images are stored inline as data URLs, so they count
// toward the size of the saved document.
import { createAnkiCardId, type MindmapAnkiCardMedia } from './anki-cards';

/** Longest edge of a stored card image, in pixels. */
export const ANKI_IMAGE_MAX_EDGE = 1280;
/** Encoded size target of one card image (before base64). */
export const ANKI_IMAGE_MAX_BYTES = 300 * 1024;
/** Hosts such as Stair reject documents above 8 MiB. */
export const DOCUMENT_SIZE_LIMIT = 8 * 1024 * 1024;
/** Adding an image may not push the document past this (room for edits). */
export const DOCUMENT_SIZE_MAX_AFTER_ADD = DOCUMENT_SIZE_LIMIT - 512 * 1024;
/** Above this the panel warns that the document is getting large. */
export const DOCUMENT_SIZE_WARNING = 6 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const ANKI_IMAGE_ACCEPT = ACCEPTED_TYPES.join(',');
const SCALES = [ANKI_IMAGE_MAX_EDGE, 960, 640];
const ENCODINGS: Array<[string, number | undefined]> = [
  ['image/png', undefined],
  ['image/jpeg', 0.85],
  ['image/jpeg', 0.7],
  ['image/jpeg', 0.55],
];

export type AnkiImageErrorCode =
  | 'unsupported'
  | 'unreadable'
  | 'too-large'
  | 'document-full';

export class AnkiImageError extends Error {
  constructor(readonly code: AnkiImageErrorCode, message: string) {
    super(message);
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close?(): void;
}

/** Browser operations, injectable for tests. */
export interface AnkiImageCodec {
  decode(file: Blob): Promise<DecodedImage>;
  encode(
    image: DecodedImage,
    width: number,
    height: number,
    type: string,
    quality?: number
  ): Promise<Blob>;
  toDataUrl(blob: Blob): Promise<string>;
}

export const browserImageCodec: AnkiImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  encode(image, width, height, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('No canvas context'));
    if (type === 'image/jpeg') {
      // JPEG has no transparency; use white like Anki's default background.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image.source, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Encode failed'))),
        type,
        quality
      )
    );
  },
  toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  },
};

export function isAcceptedImage(file: Blob): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

function fit(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Turns a file into a card image. Small images are kept as they are (which
 * keeps GIF animation); larger ones are scaled to at most
 * ANKI_IMAGE_MAX_EDGE and re-encoded as PNG or JPEG until they fit
 * ANKI_IMAGE_MAX_BYTES. Throws AnkiImageError instead of failing silently.
 */
export async function createAnkiCardImage(
  file: Blob,
  codec: AnkiImageCodec = browserImageCodec
): Promise<MindmapAnkiCardMedia> {
  if (!isAcceptedImage(file)) {
    throw new AnkiImageError('unsupported', `Unsupported type ${file.type}`);
  }
  let image: DecodedImage;
  try {
    image = await codec.decode(file);
  } catch {
    throw new AnkiImageError('unreadable', 'The image could not be read');
  }
  try {
    let blob: Blob | undefined;
    let size = { width: image.width, height: image.height };
    if (
      Math.max(image.width, image.height) <= ANKI_IMAGE_MAX_EDGE &&
      file.size <= ANKI_IMAGE_MAX_BYTES
    ) {
      blob = file;
    }
    for (const edge of blob ? [] : SCALES) {
      size = fit(image.width, image.height, edge);
      for (const [type, quality] of ENCODINGS) {
        const encoded = await codec.encode(
          image,
          size.width,
          size.height,
          type,
          quality
        );
        if (encoded.size <= ANKI_IMAGE_MAX_BYTES) {
          blob = encoded;
          break;
        }
      }
      if (blob) break;
    }
    if (!blob) {
      throw new AnkiImageError(
        'too-large',
        'The image is too large even after compression'
      );
    }
    return {
      id: createAnkiCardId(),
      url: await codec.toDataUrl(blob),
      mimeType: blob.type,
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    if (error instanceof AnkiImageError) throw error;
    throw new AnkiImageError('unreadable', 'The image could not be encoded');
  } finally {
    image.close?.();
  }
}

export function getUtf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Checks whether a document of `currentSize` bytes can take `addedUrls`.
 * Returns the projected size; throws when it would leave too little room
 * below DOCUMENT_SIZE_LIMIT.
 */
export function checkDocumentBudget(
  currentSize: number,
  addedUrls: string[]
): number {
  // JSON adds the image object around the URL; data URLs need no escaping.
  const projected =
    currentSize +
    addedUrls.reduce((total, url) => total + getUtf8Size(url) + 200, 0);
  if (projected > DOCUMENT_SIZE_MAX_AFTER_ADD) {
    throw new AnkiImageError(
      'document-full',
      `The document would be ${projected} bytes`
    );
  }
  return projected;
}

export function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** Image files from a paste or drop, in order. */
export function getImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length) {
    for (const item of Array.from(data.items ?? [])) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files.filter((file) => file.type.startsWith('image/'));
}

export function hasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types ?? []).includes('Files');
}
