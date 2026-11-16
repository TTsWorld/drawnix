// Which embedded editor handles a key. Several <Drawnix> editors can share a
// page, and Plait listens for keys on the whole document.

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Keys whose target is inside this editor belong to it. */
export function isKeyInEditor(
  container: Element | null,
  event: KeyboardEvent
): boolean {
  return (
    !!container &&
    event.target instanceof Node &&
    container.contains(event.target)
  );
}

/**
 * Board-wide shortcuts (tools, Mod+S, zoom) also work while the pointer is
 * over this editor's board and nothing has focus yet, as in upstream
 * Drawnix, unless the key went to a text field or to another editor.
 */
export function isGlobalKeyForEditor(
  container: Element | null,
  event: KeyboardEvent,
  pointerOverBoard: boolean
): boolean {
  if (isKeyInEditor(container, event)) return true;
  if (!pointerOverBoard) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest(EDITABLE)) return false;
  const editor = target.closest('.drawnix');
  return !editor || editor === container;
}
