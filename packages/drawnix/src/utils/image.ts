import { getSelectedElements, PlaitBoard, toSvgData } from '@plait/core';
import { base64ToBlob, boardToImage, download } from './common';
import { fileOpen } from '../data/filesystem';
import { IMAGE_MIME_TYPES } from '../constants';
import { insertImage } from '../data/image';
import {
  waitForPendingAnkiCardImages,
  warnPendingCardImagesTimeout,
} from '../anki-image-queue';

export const saveAsSvg = async (board: PlaitBoard) => {
  // Capture the export target before awaiting images — selection can change
  // while codecs run.
  const selectedElements = getSelectedElements(board);
  const wait = await waitForPendingAnkiCardImages(board);
  if (wait === 'timeout') warnPendingCardImagesTimeout('SVG export');
  const svgData = await toSvgData(board, {
    fillStyle: 'transparent',
    padding: 20,
    ratio: 4,
    elements: selectedElements.length > 0 ? selectedElements : undefined,
    inlineStyleClassNames: '.plait-text-container',
    styleNames: ['position'],
  });
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const imageName = `drawnix-${new Date().getTime()}.svg`;
  download(blob, imageName);
};

export const saveAsImage = async (
  board: PlaitBoard,
  isTransparent: boolean
) => {
  // Capture the export target before awaiting images — selection can change
  // while codecs run.
  const selectedElements = getSelectedElements(board);
  const wait = await waitForPendingAnkiCardImages(board);
  if (wait === 'timeout') warnPendingCardImagesTimeout('image export');
  const image = await boardToImage(board, {
    elements: selectedElements.length > 0 ? selectedElements : undefined,
    fillStyle: isTransparent ? 'transparent' : 'white',
  });
  if (image) {
    const ext = isTransparent ? 'png' : 'jpg';
    const pngImage = base64ToBlob(image);
    const imageName = `drawnix-${new Date().getTime()}.${ext}`;
    download(pngImage, imageName);
  }
};

export const addImage = async (board: PlaitBoard) => {
  const imageFile = await fileOpen({
    description: 'Image',
    extensions: Object.keys(
      IMAGE_MIME_TYPES
    ) as (keyof typeof IMAGE_MIME_TYPES)[],
  });
  insertImage(board, imageFile);
};
