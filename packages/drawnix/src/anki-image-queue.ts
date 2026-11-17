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
    // Timed out while this batch was still in flight.
    if (!settled) return 'timeout';
    // Same settled promise still registered: nothing newer is pending.
    if (getQueue() === queue) return 'idle';
    // A later batch was chained while we waited. Follow it while time remains;
    // if the bound is already exhausted, report timeout — do not claim idle
    // while work is still pending.
    if (Date.now() >= deadline) return 'timeout';
  }
}

/** Bound elapsed with work still pending: save/export what committed and warn. */
export function warnPendingCardImagesTimeout(action: string): void {
  const message = `Some card images were still processing during ${action}; continuing with what had finished.`;
  console.warn(`[Drawnix] ${message}`);
  if (typeof document === 'undefined' || !document.body) return;
  const id = 'drawnix-pending-images-timeout';
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'status');
  el.textContent = message;
  el.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'max-width:min(92vw,28rem);padding:10px 14px;border-radius:8px;' +
    'background:#1f2937;color:#f9fafb;font:13px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.25)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Long enough for a large photo to decode and re-encode, short enough to close. */
export const PENDING_ANKI_CARD_IMAGE_WAIT_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
