// Adding images to Anki cards: decoding, downscaling, re-encoding and the
// document size budget. Images are stored inline as data URLs, so they count
// toward the size of the saved document.
import { createAnkiCardId, type MindmapAnkiCardMedia } from './anki-cards';
import { stripImageMetadata } from './image-metadata';

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
type Encoding = [type: string, quality: number | undefined];
const JPEG_ENCODINGS: Encoding[] = [
  ['image/jpeg', 0.85],
  ['image/jpeg', 0.7],
  ['image/jpeg', 0.55],
];
const ENCODINGS: Encoding[] = [['image/png', undefined], ...JPEG_ENCODINGS];
/** Formats that keep transparency: PNG, then lossy WebP with alpha. */
const TRANSPARENT_ENCODINGS: Encoding[] = [
  ['image/png', undefined],
  ['image/webp', 0.9],
  ['image/webp', 0.75],
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
  /** Whether any pixel is not fully opaque. Absent: treated as opaque. */
  hasTransparency?(image: DecodedImage): boolean;
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
  hasTransparency(image) {
    // At most the stored size: enough to tell, without a full-size buffer.
    const { width, height } = fit(
      image.width,
      image.height,
      ANKI_IMAGE_MAX_EDGE
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // Unknown: keep transparency to be safe.
    if (!context) return true;
    context.drawImage(image.source, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
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
 * Turns a file into a card image without the metadata, such as EXIF (camera,
 * GPS location), that would otherwise be exported with the card.
 *
 * - PNG and WebP files within ANKI_IMAGE_MAX_EDGE and ANKI_IMAGE_MAX_BYTES
 *   keep their image data: metadata chunks are removed losslessly, so
 *   transparency and animation (APNG, animated WebP) stay. One whose EXIF
 *   rotates it is re-encoded instead, so it shows the way it did.
 * - Small GIFs are kept as they are, so they stay animated.
 * - Everything else is drawn and re-encoded (the decoder has applied the EXIF
 *   orientation), scaled to at most ANKI_IMAGE_MAX_EDGE, until it fits
 *   ANKI_IMAGE_MAX_BYTES: JPEG files as JPEG; images with transparency as
 *   PNG or WebP at each size, and only as a last resort as JPEG on white;
 *   other images as PNG, then JPEG.
 *
 * Throws AnkiImageError instead of failing silently.
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
    const withinLimits =
      Math.max(image.width, image.height) <= ANKI_IMAGE_MAX_EDGE &&
      file.size <= ANKI_IMAGE_MAX_BYTES;
    if (withinLimits && file.type === 'image/gif') {
      blob = file;
    } else if (
      withinLimits &&
      (file.type === 'image/png' || file.type === 'image/webp')
    ) {
      const stripped = stripImageMetadata(
        new Uint8Array(await file.arrayBuffer()),
        file.type
      );
      if (stripped?.orientation === 1) {
        blob = new Blob([stripped.bytes], { type: file.type });
      }
    }
    // Each pass tries every size, largest first.
    const passes: Encoding[][] =
      file.type === 'image/jpeg'
        ? [[['image/jpeg', 0.92], ...JPEG_ENCODINGS]]
        : !blob && codec.hasTransparency?.(image)
        ? [TRANSPARENT_ENCODINGS, JPEG_ENCODINGS]
        : [ENCODINGS];
    for (const encodings of blob ? [] : passes) {
      for (const edge of SCALES) {
        size = fit(image.width, image.height, edge);
        for (const [type, quality] of encodings) {
          const encoded = await codec.encode(
            image,
            size.width,
            size.height,
            type,
            quality
          );
          // Browsers without a WebP encoder return PNG instead.
          if (encoded.type === type && encoded.size <= ANKI_IMAGE_MAX_BYTES) {
            blob = encoded;
            break;
          }
        }
        if (blob) break;
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

/** UTF-8 length of a string, without encoding it (documents reach MiBs). */
export function getUtf8Size(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        i++;
      } else length += 3;
    } else length += 3;
  }
  return length;
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
    // The same number the check used, for the message.
    const error = new AnkiImageError(
      'document-full',
      `The document would be ${projected} bytes`
    );
    (error as AnkiImageError & { projected?: number }).projected = projected;
    throw error;
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
