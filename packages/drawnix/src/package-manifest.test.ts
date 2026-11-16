import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  exports: Record<string, Record<string, string>>;
};

describe('published package manifest', () => {
  it('serves the editor entry as ESM only, since Plait ships only ESM', () => {
    const editor = manifest.exports['./editor'];
    // A CommonJS build would require() @plait/* and fail with
    // ERR_REQUIRE_ESM before Node 20.19; require() of ESM works after.
    expect(editor.require).toBeUndefined();
    expect(editor.import).toBe('./editor.mjs');
    expect(editor.default).toBe('./editor.mjs');
  });

  it('expects Plait and Slate from the host, so there is one copy of each', () => {
    // Plait keeps board state in module-level WeakMaps; two copies break it.
    for (const name of [
      '@plait/core',
      '@plait/common',
      '@plait/draw',
      '@plait/layouts',
      '@plait/mind',
      '@plait/text-plugins',
      '@plait-board/react-board',
      '@plait-board/react-text',
      'slate',
      'slate-dom',
      'slate-react',
      'slate-history',
    ]) {
      expect(manifest.dependencies[name], name).toBeUndefined();
      expect(manifest.peerDependencies[name], name).toBeTruthy();
    }
  });
});
