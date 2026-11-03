import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(
  resolve(root, 'node_modules/.bin/vite'),
  ['build', '--config', 'packages/drawnix/vite.config.ts'],
  { cwd: root, stdio: 'inherit' }
);
copyFileSync(
  resolve(root, 'packages/drawnix/package.json'),
  resolve(root, 'dist/drawnix/package.json')
);
copyFileSync(
  resolve(root, 'NOTES.md'),
  resolve(root, 'dist/drawnix/README.md')
);
copyFileSync(resolve(root, 'LICENSE'), resolve(root, 'dist/drawnix/LICENSE'));
cpSync(resolve(root, 'LICENSES'), resolve(root, 'dist/drawnix/LICENSES'), {
  recursive: true,
});
