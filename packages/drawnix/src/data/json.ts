import { PlaitBoard } from '@plait/core';
import { MIME_TYPES } from '../constants';
import { fileOpen, fileSave } from './filesystem';
import { DrawnixExportedData, DrawnixExportedType } from './types';
import { loadFromBlob, normalizeFile } from './blob';
import { serializeDrawnixBoard } from '../editor';
import {
  waitForPendingAnkiCardImages,
  warnPendingCardImagesTimeout,
} from '../anki-image-queue';

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

export const saveAsJSON = async (
  board: PlaitBoard,
  name: string = getDefaultName()
) => {
  // Open the save picker within the user gesture first (fileSave accepts a
  // Promise<Blob> and shows the picker before awaiting it). Waiting for card
  // images first would drop user activation and make showSaveFilePicker fail.
  const blob = (async () => {
    const wait = await waitForPendingAnkiCardImages(board);
    if (wait === 'timeout') warnPendingCardImagesTimeout('save');
    const serialized = serializeAsJSON(board);
    return new Blob([serialized], {
      type: MIME_TYPES.drawnix,
    });
  })();

  const fileHandle = await fileSave(blob, {
    name,
    extension: 'drawnix',
    description: 'Drawnix file',
  });
  return { fileHandle };
};

export const loadFromJSON = async (board: PlaitBoard) => {
  // Open the file picker within the user gesture first. Then wait (bounded)
  // for accepted image batches so Open File does not drop them as a document
  // swap — without consuming activation before showOpenFilePicker.
  const file = await fileOpen({
    description: 'Drawnix files',
    // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
    // gets resolved. Else, iOS users cannot open `.drawnix` files.
    // extensions: ["json", "drawnix", "png", "svg"],
  });
  const wait = await waitForPendingAnkiCardImages(board);
  if (wait === 'timeout') warnPendingCardImagesTimeout('open');
  return loadFromBlob(board, await normalizeFile(file));
};

export const isValidDrawnixData = (data?: any): data is DrawnixExportedData => {
  return (
    data &&
    data.type === DrawnixExportedType.drawnix &&
    Array.isArray(data.elements) &&
    typeof data.viewport === 'object'
  );
};

export const serializeAsJSON = (board: PlaitBoard): string =>
  serializeDrawnixBoard(board);
