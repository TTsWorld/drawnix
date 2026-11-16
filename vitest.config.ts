import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    server: { deps: { inline: ['@plait-board/react-board', 'roughjs'] } },
    include: [
      'packages/drawnix/src/editor.test.ts',
      'packages/drawnix/src/anki-cards.test.ts',
      'packages/drawnix/src/anki-card-images.test.ts',
      'packages/drawnix/src/components/mindmap-notes.test.tsx',
      'packages/drawnix/src/components/mindmap-anki-cards.test.tsx',
      'packages/drawnix/src/components/mindmap-node-actions.test.tsx',
      'packages/drawnix/src/components/toolbar/popup-toolbar/popup-toolbar-placement.test.ts',
    ],
  },
});
