// Lossless removal of metadata (EXIF with GPS location, XMP, text) from PNG
// and WebP files. Chunks are copied as they are, so transparency and the
// frames of animated PNG (APNG) and animated WebP are kept, which re-encoding
// through a canvas would lose.

export interface StrippedImage {
  bytes: Uint8Array;
  /**
   * EXIF orientation of the original (1 = upright), or `undefined` if it had
   * EXIF that could not be read. Absent EXIF counts as 1.
   */
  orientation: number | undefined;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Chunks needed to show the image as the browser would; the rest are dropped. */
const PNG_KEPT_CHUNKS = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'cICP',
  'mDCV',
  'cLLI',
  // Animated PNG.
  'acTL',
  'fcTL',
  'fdAT',
]);
const WEBP_KEPT_CHUNKS = new Set([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
  'ICCP',
]);
/** VP8X flags that announce EXIF and XMP chunks. */
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

const fourCC = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

/**
 * Returns the file without metadata chunks, or `null` when it is not a
 * well-formed PNG or WebP (the caller then re-encodes it).
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  type: string
): StrippedImage | null {
  try {
    if (type === 'image/png') return stripPng(bytes);
    if (type === 'image/webp') return stripWebp(bytes);
  } catch {
    // Truncated or malformed; fall through.
  }
  return null;
}

function stripPng(bytes: Uint8Array): StrippedImage | null {
  if (!PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let orientation: number | undefined = 1;
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = fourCC(bytes, offset + 4);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    if (PNG_KEPT_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
    else if (type === 'eXIf') {
      orientation = readExifOrientation(bytes.subarray(offset + 8, end - 4));
    }
    offset = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) return null;
  return { bytes: concat(kept), orientation };
}

function stripWebp(bytes: Uint8Array): StrippedImage | null {
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) return null;
  const kept: Uint8Array[] = [];
  let orientation: number | undefined = 1;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = fourCC(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const dataEnd = offset + 8 + size;
    if (dataEnd > riffEnd) return null;
    // Chunks are padded to an even size; the last pad byte may be missing.
    const end = dataEnd + (size % 2);
    const chunkEnd = Math.min(end, riffEnd);
    if (type === 'VP8X') {
      const chunk = bytes.slice(offset, chunkEnd);
      chunk[8] &= ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      kept.push(chunk);
    } else if (WEBP_KEPT_CHUNKS.has(type)) {
      kept.push(bytes.subarray(offset, chunkEnd));
    } else if (type === 'EXIF') {
      orientation = readExifOrientation(bytes.subarray(offset + 8, dataEnd));
    }
    offset = end;
  }
  if (!kept.length) return null;
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  return { bytes: concat([header, body]), orientation };
}

/** Orientation tag (0x0112) of TIFF-structured EXIF data. */
export function readExifOrientation(data: Uint8Array): number | undefined {
  let tiff = data;
  // WebP writers sometimes keep the JPEG APP1 prefix.
  if (fourCC(tiff, 0) === 'Exif' && tiff[4] === 0 && tiff[5] === 0) {
    tiff = tiff.subarray(6);
  }
  if (tiff.length < 8) return undefined;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = fourCC(tiff, 0).slice(0, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const little = order === 'II';
  if (view.getUint16(2, little) !== 42) return undefined;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return undefined;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return undefined;
    if (view.getUint16(entry, little) === 0x0112) {
      return view.getUint16(entry + 8, little);
    }
  }
  return 1;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
