import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    server: { deps: { inline: ['@plait-board/react-board', 'roughjs'] } },
    // Every *.test file; jest ignores them (packages/drawnix/jest.config.ts).
    include: ['packages/drawnix/src/**/*.test.{ts,tsx}'],
  },
});
