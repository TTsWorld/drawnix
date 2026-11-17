import type { PlaitBoard } from '@plait/core';

// Card image batches accepted by the panel are processed asynchronously, and
// `onValueChange` only fires once a batch commits. Hosts closing or switching
// the board need to wait for the batches still in flight, or an image the user
// already added is lost. The queue itself lives in the card panel component;
// this registry lets the editor's host API reach it by board.

const QUEUES = new WeakMap<PlaitBoard, () => Promise<unknown>>();

/** Called by the card panel when it mounts; the getter reads the live chain. */
export function setPendingAnkiCardImageQueue(
  board: PlaitBoard,
  getQueue: () => Promise<unknown>
): void {
  QUEUES.set(board, getQueue);
}

/**
 * Whether every accepted card-image batch settled within the wait bound
 * (`idle`), or the bound elapsed while work was still in flight (`timeout`).
 * Hosts must treat `timeout` as "save what is there and warn" — not as success.
 */
export type PendingCardImagesWaitResult = 'idle' | 'timeout';

/**
 * Resolves once every card image batch accepted so far has committed, been
 * refused, or `timeoutMs` has passed — the wait is bounded, so closing a board
 * never hangs on a stuck codec. A batch that refuses (document swapped, target
 * card deleted, over budget) also settles the queue.
 *
 * Returns `'idle'` when the queue is clear, `'timeout'` when the bound elapsed
 * with work still pending. Callers that serialize after this wait still get
 * whatever already committed on the board (including after `onValueChange` was
 * detached on unmount).
 */
export async function waitForPendingAnkiCardImages(
  board: PlaitBoard,
  timeoutMs = PENDING_ANKI_CARD_IMAGE_WAIT_MS
): Promise<PendingCardImagesWaitResult> {
  const getQueue = QUEUES.get(board);
  if (!getQueue) return 'idle';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const queue = getQueue();
    if (!queue) return 'idle';
    const settled = await Promise.race([
      queue.then(
        () => true,
        () => true
      ),
      delay(Math.max(0, deadline - Date.now())).then(() => false),
    ]);
    // Timed out: tell the host so it can save what committed and warn.
    if (!settled) return 'timeout';
    // Queue cleared, or the bound is exhausted after a settle: idle.
    // A later batch may have been chained while we waited — follow it while
    // time remains.
    if (getQueue() === queue || Date.now() >= deadline) return 'idle';
  }
}

/** Long enough for a large photo to decode and re-encode, short enough to close. */
export const PENDING_ANKI_CARD_IMAGE_WAIT_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
