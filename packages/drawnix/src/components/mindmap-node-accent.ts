// Colors of a node's buttons and dot: the node's own stroke color (or its
// branch color) over the canvas color of the current theme.
import { DEFAULT_COLOR, type PlaitBoard } from '@plait/core';
import {
  getBranchColorByMindElement,
  getMindThemeColor,
  getStrokeColorByElement,
  type MindElement,
  PlaitMind,
} from '@plait/mind';
import { isNoColor, isTransparent, removeHexAlpha } from '../utils/color';

const DEFAULT_CANVAS = '#ffffff';
/** Text on a count badge whose accent is too light for white. */
export const NODE_ACCENT_DARK_TEXT = '#1f2329';
// Below this contrast against the canvas a color does not read as an accent
// (the default root stroke #f5f5f5 on white is 1.09).
const MIN_CANVAS_CONTRAST = 1.3;
// White text on lighter accents (yellow, light theme roots) is unreadable.
const MIN_WHITE_TEXT_CONTRAST = 2;

/** Relative luminance of a #rgb / #rrggbb(aa) color, or null for others. */
export function getLuminance(color: string): number | null {
  const hex = removeHexAlpha(color.trim()).replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  const [r, g, b] = [0, 2, 4].map((start) => {
    const value = parseInt(full.slice(start, start + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Canvas color of the board's theme. */
export function getCanvasColor(board: PlaitBoard): string {
  return getMindThemeColor(board).boardBackground?.trim() || DEFAULT_CANVAS;
}

export function isDarkCanvas(canvas: string) {
  const luminance = getLuminance(canvas);
  return luminance !== null && luminance < 0.4;
}

const usable = (color: unknown): color is string =>
  typeof color === 'string' &&
  !!color.trim() &&
  color !== 'none' &&
  !isTransparent(color) &&
  !isNoColor(color);

/**
 * The node's stroke color, else its branch color; the root's default stroke
 * is its fill, so a root that blends into the canvas falls back to the
 * theme's root text color. Alpha is dropped: the CSS mixes its own tints.
 */
export function getNodeAccent(
  board: PlaitBoard,
  element: MindElement,
  canvas: string
): string {
  const theme = getMindThemeColor(board);
  const candidates = [
    getStrokeColorByElement(board, element),
    PlaitMind.isMind(element)
      ? undefined
      : getBranchColorByMindElement(board, element),
    theme.rootTextColor,
    DEFAULT_COLOR,
  ];
  const canvasLuminance = getLuminance(canvas);
  for (const candidate of candidates) {
    if (!usable(candidate)) continue;
    const color = candidate.trim();
    const luminance = getLuminance(color);
    // Colors we cannot measure (named, rgb()) are taken as they are.
    if (luminance === null) return color;
    if (
      canvasLuminance === null ||
      contrast(luminance, canvasLuminance) >= MIN_CANVAS_CONTRAST
    ) {
      return removeHexAlpha(color);
    }
  }
  return DEFAULT_COLOR;
}

/** White unless the accent is too light for it. */
export function getAccentTextColor(accent: string) {
  const luminance = getLuminance(accent);
  if (luminance === null) return '#ffffff';
  return contrast(luminance, 1) >= MIN_WHITE_TEXT_CONTRAST
    ? '#ffffff'
    : NODE_ACCENT_DARK_TEXT;
}
