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
 * Resolves once every card image batch accepted so far has committed, been
 * refused, or `timeoutMs` has passed — the wait is bounded, so closing a board
 * never hangs on a stuck codec. A batch that refuses (document swapped, target
 * card deleted, over budget) also settles the queue.
 */
export async function waitForPendingAnkiCardImages(
  board: PlaitBoard,
  timeoutMs = PENDING_ANKI_CARD_IMAGE_WAIT_MS
): Promise<void> {
  const getQueue = QUEUES.get(board);
  if (!getQueue) return;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const queue = getQueue();
    if (!queue) return;
    const settled = await Promise.race([
      queue.then(
        () => true,
        () => true
      ),
      delay(Math.max(0, deadline - Date.now())).then(() => false),
    ]);
    // Timed out, or a later batch was chained while we waited: stop at the
    // bound either way; otherwise follow the chain once more.
    if (!settled || getQueue() === queue || Date.now() >= deadline) return;
  }
}

/** Long enough for a large photo to decode and re-encode, short enough to close. */
export const PENDING_ANKI_CARD_IMAGE_WAIT_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
