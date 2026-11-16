# Drawnix with node notes

Fork of [plait-board/drawnix](https://github.com/plait-board/drawnix), based on
`v0.4.0-2` (`1d614bb60fc99132e0cd55a608a14fe786f4ee9b`).
Published package: `@ttsworld/drawnix`.

Install the versioned GitHub release archive (no npm registry publication required):

```sh
npm install https://github.com/TTsWorld/drawnix/releases/download/v0.4.0-notes.7/ttsworld-drawnix-0.4.0-notes.7.tgz
```

## Run independently

```sh
npm ci
npm run dev:notes -- --host 127.0.0.1
```

Open the printed address. Create or select a mind-map node, choose **Add note**
in its floating toolbar, and type in the side panel. A note icon appears next
to nodes with notes. Click it to reopen the panel. Notes use plain multiline
text. Changes participate in the board's undo/redo history. Continuous typing
in one note is one undo step; leaving the input, switching nodes, undo/redo,
or another document edit starts a new step. Copy, cut, and paste in the panel
operate on note text. Input updates immediately; note icons refresh after
Plait has updated the node layout references. Each input resolves its node by
ID against the current document, so concurrent Agent edits cannot redirect
typing to another node after a move or deletion. The standalone
web app stores the document locally; the app menu exports and imports
`.drawnix` files including notes.

## Anki cards

Anki cards are a second node widget, independent of notes. A node can have no
cards, one, or many. Choose **Add Anki card** in a selected node's floating
toolbar, or click the card badge (icon and count) next to a node, to open the
side panel. New cards copy the node title to the front and the note to the
back; afterwards cards are independent of the node text. The panel adds,
edits, and deletes cards; tags are separated by spaces. Notes and cards share
the panel position, so opening one closes the other. Keyboard, clipboard, and
undo/redo in the panel follow the note panel: continuous typing in one field is
one undo step.

The panel shows one card at a time. A dropdown switches between cards (and
adds a new one); tabs switch between the front and the back. Each side has text
and images: use the add-image button, paste an image, or drop image files on
the panel. Pastes and drops in the panel never reach the board.

Cards are stored at `MindElement.ankiCards` (outside `data`, like notes):

```ts
ankiCards?: Array<{
  id: string;
  front: string;
  back: string;
  tags?: string[];
  frontImages?: MindmapAnkiCardMedia[]; // shown after the front text
  backImages?: MindmapAnkiCardMedia[];
}>;
// MindmapAnkiCardMedia: { id, url (data URL), mimeType, width, height }
```

Images are stored inline as data URLs, like other Drawnix images. PNG, JPEG,
GIF and WebP are accepted. Every image is redrawn and re-encoded (PNG, then
JPEG; JPEG first for JPEG files), scaled to at most 1280 px and 300 KiB. This
drops metadata such as EXIF camera data and GPS location, which would
otherwise be exported with the card. GIFs within those limits are kept
unchanged so they stay animated; larger GIFs become still images. An
image is not added if the document would exceed 7.5 MiB (hosts such as Stair
reject documents above 8 MiB); the panel shows an error, and a warning above
6 MiB. The same limit applies to the whole editor: a paste or duplicate that
would take the document past 8 MiB is refused with a notice, and after any
other change (redo, Agent commands, images on the board) a notice at the
bottom of the editor reports a document above 6 MiB or over 8 MiB. Those
changes are not refused, so hosts must still handle a save that is too large. Readers (`readAnkiCards()`, `getMindmapAnkiCards()`, the panel) only
accept images with a UUID-shaped `id` and a base64 `data:image/(png|jpeg|gif|webp)`
URL, and take `mimeType` from that URL; external URLs, SVG and other entries
are skipped (not shown, not exported). Documents are still untrusted input:
exporters must not use any field as a file path without their own checks, and
should name media files by content (for example a hash), because an edited
document can give two different images the same ID. The node's own
`image.url` (from `data.image`) is passed through unchecked and may be an
external URL.

`id` is a random UUID that never changes, so hosts can use it as the Anki note
GUID across repeated exports. Copied or duplicated cards always get new IDs
when pasted, also into another document, so two cards never share a GUID. Cut
and paste in the same document moves cards and keeps their IDs, as long as the
cut is still in that document's undo history and the IDs are not already on
the board; pasting the same cut again renews them. Pasting a cut into another
document (another board, window or tab, or after a reload) renews the IDs like
a copy. A card ID therefore never leaves the document it was made in, so undo
and redo in either document can never make two documents share a GUID. Nothing
is stored outside the document for this.

The editor keeps card IDs unique within a document. Duplicates (for example
from older versions or upstream Drawnix, which copy cards unchanged) are
repaired after loading, after the host replaces the document, and after every
change: the first card in document tree order keeps its ID, later ones get an
ID derived from the node ID and the duplicated ID, so the same data is always
repaired the same way. The repair is written to the document without an undo
step. `readAnkiCards()` and `getMindmapAnkiCards()` apply the same rule, so
their IDs are unique even for documents that were never opened. Pasting keeps card fields this
version does not know. Deleting the last card removes the field. `front` and `back` are plain multiline text; exporters must escape
HTML and convert line breaks. Card images, image occlusion, scheduling, and
`.apkg` export are not part of this package.

Read cards for export with `editor.readAnkiCards()`, or headlessly with
`getMindmapAnkiCards(document.elements)` from `@ttsworld/drawnix/editor`. Both
return nodes with cards, depth-first in document order:

```ts
{ nodeId: string; topic: string; image?: { url; width; height }; cards: MindmapAnkiCard[] }[]
```

`image` is the node's own `data.image` reference. Malformed card entries are
skipped.

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

**Switching documents.** Passing a different document as `value` (or opening a
file from the menu) replaces the board's elements without an operation. The
editor detects this and treats it as a new document: undo/redo history is
cleared, so undo never applies the previous document's steps to the new one;
cuts made in the previous document paste as copies (new card IDs); card images
still being processed for the previous document are dropped with a notice; and
duplicate card IDs in the new document are repaired. Hosts that echo the
document back through `value` after each change must pass the same array they
got from `onValueChange`, not a copy, or every change counts as a new document.
Remounting `<Drawnix>` (a React `key` per document) also works.

The host owns storage, save scheduling, conflict detection, permissions, and
any Agent transport. This package has no Stair, Electron, Project, or session
dependency. Use `onViewportChange` and `onThemeChange` to persist presentation
changes as well.

`DrawnixEditor` exposes only:

- `serialize(): string` — current native document, including notes and theme.
- `readMindmap(): MindmapNode[]` — node IDs, topics, optional notes, and children.
- `readAnkiCards(): MindmapAnkiCardNode[]` — every node with Anki cards (see above).
- `updateMindmap(operations): void` — atomic batches of 1–50 operations, with one
  undo entry per batch. Supported operations: `populate_empty`, `set_topic`,
  `insert_child`, `insert_sibling`, and `set_note` (`nodeId`, `note`). An empty
  note removes the field. The host must reject stale or unauthorized commands
  before calling this method.

The headless `./editor` entry also exports `createMindmapDocument(markdown)`,
`parseDrawnixDocument(content)`, and `getMindmapAnkiCards(elements)` for
document creation, loading, and card export.

## Data compatibility

Notes are an optional string at `MindElement.note`, and Anki cards an optional
array at `MindElement.ankiCards`, both outside `data`. Existing documents need
no migration. A node's title stays in `data.topic`; Plait's
emoji transforms rebuild `data`, so notes must not be stored there. Keep
notes and cards with their nodes during copy, move, undo, and serialization.
Upstream Drawnix does not display these extensions, and duplicating a node
there copies card IDs unchanged; edits made with other versions must
be checked for preservation before relying on round trips.

## Verify and package

```sh
npm run test:notes
npm run typecheck:notes
npm run build:package
npm pack ./dist/drawnix --pack-destination dist
```

Both the standalone package build and the Nx library build emit `README.md`,
`LICENSE`, and `LICENSES/stair-Apache-2.0.txt`. Check that these files are present
in the final archive before publishing, including after building the web app.

Use the versioned package archive for consumers. Do not depend on a sibling
checkout or a developer's `npm link`. The fork keeps Plait as a dependency,
currently pinned to the versions used by the host (0.92.3).

Manual acceptance: create a node, add multiline notes, close/reopen the panel,
rename and duplicate the node, remove a note and undo/redo, export/import the
file, and reload the page. Verify the same flows in the embedded host.

Document commands adapted from `build-my-work/stair` retain their Apache-2.0
license; see `LICENSES/stair-Apache-2.0.txt`. Upstream Drawnix retains its MIT
license.
