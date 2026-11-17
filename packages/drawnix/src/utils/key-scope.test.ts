// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  isFocusInEditor,
  isGlobalKeyForEditor,
  isKeyInEditor,
} from './key-scope';

function editor() {
  const container = document.createElement('div');
  container.className = 'drawnix';
  container.tabIndex = -1;
  const input = document.createElement('textarea');
  container.append(input);
  document.body.append(container);
  return { container, input };
}

function key(target: EventTarget) {
  const event = new KeyboardEvent('keydown', { key: 'm', bubbles: true });
  let received: KeyboardEvent = event;
  target.addEventListener('keydown', (e) => (received = e as KeyboardEvent), {
    once: true,
  });
  target.dispatchEvent(event);
  return received;
}

/** Simulates focus: the key targets the focused element, as in a browser. */
function focused(target: HTMLElement) {
  target.focus();
  return key(target);
}

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = '';
});

describe('keyboard scope of embedded editors', () => {
  it('handles board shortcuts while the editor container has focus', () => {
    const { container } = editor();
    // A click on the board focused the container; the key goes to it.
    const event = focused(container);
    expect(isKeyInEditor(container, event)).toBe(true);
    expect(isFocusInEditor(container)).toBe(true);
    expect(isGlobalKeyForEditor(container, event)).toBe(true);
  });

  it('ignores board shortcuts while nothing in the editor has focus', () => {
    const { container } = editor();
    const event = key(document.body);
    expect(isFocusInEditor(container)).toBe(false);
    expect(isGlobalKeyForEditor(container, event)).toBe(false);
  });

  it('always handles keys inside the editor', () => {
    const { container, input } = editor();
    expect(isGlobalKeyForEditor(container, key(container))).toBe(true);
    expect(isGlobalKeyForEditor(container, key(input))).toBe(true);
  });

  it('leaves keys typed into host fields or another editor alone', () => {
    const a = editor();
    const b = editor();
    const hostField = document.createElement('input');
    const hostEditable = document.createElement('div');
    hostEditable.setAttribute('contenteditable', 'true');
    document.body.append(hostField, hostEditable);
    for (const target of [hostField, hostEditable, b.container, b.input]) {
      expect(isGlobalKeyForEditor(a.container, key(target))).toBe(false);
    }
  });

  it('does not take shortcuts while a host control has focus, even with the pointer over the board', () => {
    const { container } = editor();
    const button = document.createElement('button');
    document.body.append(button);
    // Pointer position no longer matters; the focused host button keeps the key.
    const event = focused(button);
    expect(isGlobalKeyForEditor(container, event)).toBe(false);
  });
});
