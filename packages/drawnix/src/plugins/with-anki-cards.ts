import {
  type PlaitBoard,
  type PlaitElement,
  PlaitHistoryBoard,
  type PlaitOperation,
  Transforms,
  WritableClipboardOperationType,
} from '@plait/core';
import {
  collectAnkiCardIds,
  createAnkiCardId,
  deriveAnkiCardId,
  findDuplicateAnkiCardIds,
  markAnkiCardsCut,
  prepareAnkiCardsForPaste,
} from '../anki-cards';

// Cuts whose card IDs are in use: the first paste of a cut keeps the IDs
// (the cards moved), later pastes renew them. Shared by every board in this
// page and, via localStorage, by other windows of the same origin and across
// reloads.
const PASTED_CUTS_KEY = 'drawnix-anki-pasted-cuts';
const MAX_PASTED_CUTS = 100;
let pastedCutsInMemory: string[] = [];

function readPastedCuts(): Set<string> {
  // Shared storage is authoritative when available, so a cut freed in another
  // window is free here too; memory is only the fallback.
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      const stored: unknown = JSON.parse(
        storage.getItem(PASTED_CUTS_KEY) ?? '[]'
      );
      return new Set(
        Array.isArray(stored)
          ? stored.filter((cut): cut is string => typeof cut === 'string')
          : []
      );
    }
  } catch {
    // Unavailable or invalid storage: use memory.
  }
  return new Set(pastedCutsInMemory);
}

function writePastedCuts(cuts: Set<string>) {
  pastedCutsInMemory = Array.from(cuts).slice(-MAX_PASTED_CUTS);
  try {
    globalThis.localStorage?.setItem(
      PASTED_CUTS_KEY,
      JSON.stringify(pastedCutsInMemory)
    );
  } catch {
    // Keep the in-memory record only.
  }
}

function updatePastedCuts(change: (cuts: Set<string>) => void) {
  const cuts = readPastedCuts();
  change(cuts);
  writePastedCuts(cuts);
}

/**
 * A history step that holds a cut's original card IDs: the source removal of
 * a cut, or the first paste that kept the IDs. Only undo/redo of exactly
 * this step changes who has the IDs.
 */
interface CutStep {
  cutId: string;
  role: 'source' | 'paste';
  batch: PlaitOperation[];
  cardIds: Set<string>;
  /** Whether this board holds the cut's original IDs because of this step. */
  owns: boolean;
}

/** Gives cards that came back with a cut's IDs, now held elsewhere, new IDs. */
function renewCards(board: PlaitBoard, cardIds: Set<string>) {
  const used = collectAnkiCardIds(board.children, new Set());
  const fixes: Array<{ path: number[]; ankiCards: unknown[] }> = [];
  const walk = (list: PlaitElement[], parent: number[]) =>
    list.forEach((element, index) => {
      const path = [...parent, index];
      const cards: unknown = element?.['ankiCards'];
      if (Array.isArray(cards) && cards.some((c) => cardIds.has(c?.id))) {
        fixes.push({
          path,
          ankiCards: cards.map((card) => {
            if (!card || !cardIds.has(card.id)) return card;
            let attempt = 0;
            let id: string;
            do id = deriveAnkiCardId(String(element.id), card.id, attempt++);
            while (used.has(id));
            used.add(id);
            return { ...card, id };
          }),
        });
      }
      if (Array.isArray(element?.children)) walk(element.children, path);
    });
  walk(board.children, []);
  PlaitHistoryBoard.withoutSaving(board, () => {
    for (const fix of fixes) {
      Transforms.setNode(board, { ankiCards: fix.ankiCards }, fix.path);
    }
  });
}

/**
 * Keeps card IDs unique and stable:
 *
 * - Copy, cut, duplicate and paste: copies get new card IDs; the first paste
 *   of a cut keeps them so the cards move with their node. That paste step
 *   and the cut's removal step are tied to history: undoing the paste frees
 *   the cut again (pasting again is still the same move), redoing it takes
 *   the IDs back. If the IDs are held elsewhere by then (another document
 *   took the move), the restored cards get new IDs instead. Undoing a cut
 *   whose IDs another document already took does the same.
 * - Duplicate card IDs in the document (older data, upstream Drawnix,
 *   host edits) are repaired after loading and after every change, without
 *   adding an undo step. See findDuplicateAnkiCardIds.
 */
export const withAnkiCards = (board: PlaitBoard) => {
  const {
    buildFragment,
    deleteFragment,
    insertFragment,
    undo,
    redo,
    afterChange,
  } = board;
  const steps: CutStep[] = [];
  let pendingCut: { cutId: string; cardIds: Set<string> } | null = null;
  const lastBatch = (list?: PlaitOperation[][]) => list?.[list.length - 1];

  board.buildFragment = (
    clipboardContext,
    rectangle,
    operationType,
    originData
  ) => {
    const context = buildFragment(
      clipboardContext,
      rectangle,
      operationType,
      originData
    );
    pendingCut = null;
    if (
      operationType === WritableClipboardOperationType.cut &&
      Array.isArray(context?.elements)
    ) {
      const cutId = createAnkiCardId();
      const elements = markAnkiCardsCut(context.elements, cutId);
      const cardIds = collectAnkiCardIds(context.elements, new Set());
      if (cardIds.size) pendingCut = { cutId, cardIds };
      return { ...context, elements };
    }
    return context;
  };

  // Plait removes the cut elements right after building the fragment.
  board.deleteFragment = (elements) => {
    deleteFragment(elements);
    const batch = lastBatch(board.history?.undos);
    if (pendingCut && batch) {
      steps.push({ ...pendingCut, role: 'source', batch, owns: false });
    }
    pendingCut = null;
  };

  board.insertFragment = (clipboardData, targetPoint, operationType) => {
    const kept = new Map<string, string>();
    if (clipboardData?.elements?.length) {
      const pastedCuts = readPastedCuts();
      const count = pastedCuts.size;
      clipboardData = {
        ...clipboardData,
        elements: prepareAnkiCardsForPaste(
          clipboardData.elements,
          board.children,
          pastedCuts,
          kept
        ),
      };
      if (pastedCuts.size !== count) writePastedCuts(pastedCuts);
    }
    insertFragment(clipboardData, targetPoint, operationType);
    const batch = lastBatch(board.history?.undos);
    if (!kept.size || !batch) return;
    const byCut = new Map<string, Set<string>>();
    kept.forEach((cutId, cardId) =>
      byCut.set(cutId, (byCut.get(cutId) ?? new Set()).add(cardId))
    );
    byCut.forEach((cardIds, cutId) =>
      steps.push({ cutId, role: 'paste', batch, cardIds, owns: true })
    );
  };

  /** After a step's cards came back: take the cut's IDs, or renew them. */
  const restored = (step: CutStep) => {
    if (readPastedCuts().has(step.cutId)) {
      renewCards(board, step.cardIds);
      return;
    }
    updatePastedCuts((cuts) => cuts.add(step.cutId));
    step.owns = true;
  };
  /** After a step's cards left the board: free the cut if this step had it. */
  const removed = (step: CutStep) => {
    if (!step.owns) return;
    step.owns = false;
    updatePastedCuts((cuts) => cuts.delete(step.cutId));
  };
  const replay =
    (
      run: () => void,
      list: () => PlaitOperation[][] | undefined,
      isUndo: boolean
    ) =>
    () => {
      const batch = lastBatch(list());
      const affected = batch
        ? steps.filter((step) => step.batch === batch)
        : [];
      run();
      for (const step of affected) {
        // Undoing a paste or redoing a cut removes the cards; the opposite
        // brings them back.
        const back = (step.role === 'paste') !== isUndo;
        if (back) restored(step);
        else removed(step);
      }
    };
  if (undo) board.undo = replay(undo, () => board.history?.undos, true);
  if (redo) board.redo = replay(redo, () => board.history?.redos, false);

  let repairScheduled = false;
  const scheduleRepair = () => {
    if (repairScheduled) return;
    repairScheduled = true;
    // After Plait finishes the current change; never inside its flush.
    queueMicrotask(() => {
      repairScheduled = false;
      repairDuplicateAnkiCardIds(board);
    });
  };
  board.afterChange = () => {
    afterChange();
    scheduleRepair();
  };
  // Documents passed in at creation have no change notification.
  scheduleRepair();
  return board;
};

/**
 * Writes the repair of duplicate card IDs back to the document. It is not
 * an undo step: undo cannot bring the duplicates back for good, because a
 * restored duplicate is repaired again to the same derived ID.
 */
export function repairDuplicateAnkiCardIds(board: PlaitBoard): boolean {
  const fixes = findDuplicateAnkiCardIds(board.children);
  if (!fixes.length) return false;
  PlaitHistoryBoard.withoutSaving(board, () => {
    for (const fix of fixes) {
      Transforms.setNode(board, { ankiCards: fix.ankiCards }, fix.path);
    }
  });
  return true;
}
