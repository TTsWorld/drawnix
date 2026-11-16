// Card picker of the Anki panel: its button is the panel title and opens a
// menu that lists the cards. Each row ends with a button that deletes that
// card; with the keyboard, Delete or Backspace on a row does the same.
import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import { ChevronDownIcon, TrashIcon } from './icons';

const TABBABLE =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** The first tabbable element after `element` and outside it. */
function nextTabbable(element: HTMLElement): HTMLElement | undefined {
  return Array.from(
    element.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE)
  ).find(
    (candidate) =>
      !element.contains(candidate) &&
      !candidate.hidden &&
      element.compareDocumentPosition(candidate) &
        Node.DOCUMENT_POSITION_FOLLOWING
  );
}

export interface AnkiCardPickerItem {
  id: string;
  label: string;
  /** Accessible name of the row's delete button ("Delete card 2"). */
  deleteLabel: string;
}

export const AnkiCardPicker = ({
  items,
  currentIndex,
  selectLabel,
  onSelect,
  onDelete,
}: {
  items: AnkiCardPickerItem[];
  currentIndex: number;
  /** Accessible name of the menu ("Select card"). */
  selectLabel: string;
  onSelect: (id: string) => void;
  /** Deletes that card; the menu stays open on the remaining cards. */
  onDelete: (id: string) => void;
}) => {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Index of the card row that has focus while the menu is open.
  const [active, setActive] = useState(currentIndex);
  const entryCount = items.length;
  const current = items[currentIndex];

  const openMenu = (at = currentIndex) => {
    setActive(at);
    setOpen(true);
  };
  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  // Also after a delete: the focused row is gone and `active` may not change.
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
      [active]?.focus();
  }, [open, active, items.length]);

  // A press elsewhere, also inside the panel, closes only the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Cards can change while the menu is open (undo, Agent edits).
  useEffect(() => {
    setActive((value) => Math.max(0, Math.min(value, entryCount - 1)));
  }, [entryCount]);

  const deleteAt = (at: number) => {
    const item = items[at];
    if (!item) return;
    // The neighbour moves into this row and keeps focus.
    setActive(at);
    onDelete(item.id);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(
        event.key === 'ArrowUp' && !open ? entryCount - 1 : currentIndex
      );
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const move = (at: number) => {
      event.preventDefault();
      setActive((at + entryCount) % entryCount);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(active + 1);
      case 'ArrowUp':
        return move(active - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(entryCount - 1);
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        // Focus moves to the next card; holding the key must not delete it too.
        if (event.repeat) return;
        return deleteAt(active);
      case 'Escape':
        // Close the menu, not the panel.
        event.preventDefault();
        event.stopPropagation();
        return closeMenu(true);
      case 'Tab': {
        // The focused item unmounts with the menu, so the browser would
        // continue from the start of the page; move focus here instead.
        event.preventDefault();
        const next = event.shiftKey
          ? trigger.current
          : root.current && nextTabbable(root.current);
        setOpen(false);
        (next ?? trigger.current)?.focus();
        return;
      }
    }
  };

  return (
    <div className="drawnix-anki-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="drawnix-anki-picker-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${selectLabel}: ${current?.label ?? ''}`}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="drawnix-anki-picker-label">{current?.label}</span>
        <span className="drawnix-anki-picker-count" aria-hidden>
          {currentIndex + 1}/{items.length}
        </span>
        {ChevronDownIcon}
      </button>
      {open && (
        <div
          id={menuId}
          className="drawnix-anki-menu"
          role="menu"
          aria-label={selectLabel}
          onKeyDown={onMenuKeyDown}
        >
          <div className="drawnix-anki-menu-cards">
            {items.map((item, i) => (
              <div
                key={item.id}
                role="none"
                className="drawnix-anki-menu-row"
                onPointerMove={() => i !== active && setActive(i)}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={i === currentIndex}
                  aria-keyshortcuts="Delete Backspace"
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => {
                    closeMenu(true);
                    onSelect(item.id);
                  }}
                >
                  {item.label}
                </button>
                <button
                  type="button"
                  className="drawnix-anki-menu-delete"
                  aria-label={item.deleteLabel}
                  title={item.deleteLabel}
                  // Reached with Delete/Backspace on the row, not with Tab,
                  // which leaves the menu.
                  tabIndex={-1}
                  // Keep focus on the rows instead of this button.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteAt(i);
                  }}
                >
                  {TrashIcon}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
