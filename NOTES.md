# Drawnix with node notes

Fork of [plait-board/drawnix](https://github.com/plait-board/drawnix), based on
`v0.4.0-2` (`1d614bb60fc99132e0cd55a608a14fe786f4ee9b`).
Published package: `@ttsworld/drawnix`.

Install the versioned GitHub release archive (no npm registry publication required):

```sh
npm install https://github.com/TTsWorld/drawnix/releases/download/v0.4.0-notes.2/ttsworld-drawnix-0.4.0-notes.2.tgz
```

## Run independently

```sh
npm ci
npm run dev:notes -- --host 127.0.0.1
```

Open the printed address. Create or select a mind-map node, choose **Add note**
in its floating toolbar, and type in the side panel. A note icon appears next
to nodes with notes. Click it to reopen the panel. Notes use plain multiline
text. Changes participate in the board's undo/redo history. The standalone
web app stores the document locally; the app menu exports and imports
`.drawnix` files including notes.

## Embed

```tsx
import { Drawnix } from '@ttsworld/drawnix';
import type { DrawnixEditor } from '@ttsworld/drawnix/editor';
import { parseDrawnixDocument } from '@ttsworld/drawnix/editor';
import '@ttsworld/drawnix/index.css';

const document = parseDrawnixDocument(fileContents);
let editor: DrawnixEditor;

<Drawnix
  value={document.elements}
  viewport={document.viewport}
  theme={document.theme}
  onEditorReady={value => { editor = value; }}
  onValueChange={() => hostSave(editor.serialize())}
/>;
```

The host owns storage, save scheduling, conflict detection, permissions, and
any Agent transport. This package has no Stair, Electron, Project, or session
dependency. Use `onViewportChange` and `onThemeChange` to persist presentation
changes as well.

`DrawnixEditor` exposes only:

- `serialize(): string` — current native document, including notes and theme.
- `readMindmap(): MindmapNode[]` — node IDs, topics, optional notes, and children.
- `updateMindmap(operations): void` — atomic batches of 1–50 operations, with one
  undo entry per batch. Supported operations: `populate_empty`, `set_topic`,
  `insert_child`, `insert_sibling`, and `set_note` (`nodeId`, `note`). An empty
  note removes the field. The host must reject stale or unauthorized commands
  before calling this method.

The headless `./editor` entry also exports `createMindmapDocument(markdown)`
and `parseDrawnixDocument(content)` for document creation and loading.

## Data compatibility

Notes are an optional string at `MindElement.note`, outside `data`. Existing
documents need no migration. A node's title stays in `data.topic`; Plait's
emoji transforms rebuild `data`, so notes must not be stored there. Keep
notes with their nodes during copy, move, undo, and serialization. Upstream
Drawnix does not display this extension; edits made with other versions must
be checked for preservation before relying on round trips.

## Verify and package

```sh
npm run test:notes
npm run typecheck:notes
npm run build:package
npm pack ./dist/drawnix --pack-destination dist
```

Use the versioned package archive for consumers. Do not depend on a sibling
checkout or a developer's `npm link`. The fork keeps Plait as a dependency,
currently pinned to the versions used by the host (0.92.3).

Manual acceptance: create a node, add multiline notes, close/reopen the panel,
rename and duplicate the node, remove a note and undo/redo, export/import the
file, and reload the page. Verify the same flows in the embedded host.

Document commands adapted from `build-my-work/stair` retain their Apache-2.0
license; see `LICENSES/stair-Apache-2.0.txt`. Upstream Drawnix retains its MIT
license.
