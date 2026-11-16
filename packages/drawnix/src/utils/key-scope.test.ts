// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isGlobalKeyForEditor, isKeyInEditor } from './key-scope';

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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('keyboard scope of embedded editors', () => {
  it('handles board shortcuts while the pointer is over the board before any click', () => {
    const { container } = editor();
    // Nothing focused yet: the key goes to the body.
    const event = key(document.body);
    expect(isKeyInEditor(container, event)).toBe(false);
    expect(isGlobalKeyForEditor(container, event, true)).toBe(true);
    expect(isGlobalKeyForEditor(container, event, false)).toBe(false);
  });

  it('always handles keys inside the editor', () => {
    const { container, input } = editor();
    expect(isGlobalKeyForEditor(container, key(container), false)).toBe(true);
    expect(isGlobalKeyForEditor(container, key(input), false)).toBe(true);
  });

  it('leaves keys typed into host fields or another editor alone', () => {
    const a = editor();
    const b = editor();
    const hostField = document.createElement('input');
    const hostEditable = document.createElement('div');
    hostEditable.setAttribute('contenteditable', 'true');
    document.body.append(hostField, hostEditable);
    for (const target of [hostField, hostEditable, b.container, b.input]) {
      expect(isGlobalKeyForEditor(a.container, key(target), true)).toBe(false);
    }
    // A focused host button is not a text field.
    const button = document.createElement('button');
    document.body.append(button);
    expect(isGlobalKeyForEditor(a.container, key(button), true)).toBe(true);
  });
});
