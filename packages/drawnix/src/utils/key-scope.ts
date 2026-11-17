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

/** Whether this editor's container, or a control inside it, has focus. */
export function isFocusInEditor(container: Element | null): boolean {
  const active = document.activeElement;
  return (
    !!container && active instanceof Node && container.contains(active)
  );
}

/**
 * Board-wide shortcuts (tools, Mod+S, zoom) also work while this editor has
 * focus, as after a click on its board. Focus decides, not the pointer: with
 * focus on a host control the key belongs to the host, even when the pointer
 * happens to rest over this board.
 */
export function isGlobalKeyForEditor(
  container: Element | null,
  event: KeyboardEvent
): boolean {
  if (isKeyInEditor(container, event)) return true;
  if (!isFocusInEditor(container)) return false;
  // Defensive for synthetic events whose target is not the focused element.
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest(EDITABLE);
}
