import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    server: { deps: { inline: ['@plait-board/react-board', 'roughjs'] } },
    include: [
      'packages/drawnix/src/editor.test.ts',
      'packages/drawnix/src/components/mindmap-notes.test.tsx',
    ],
  },
});
