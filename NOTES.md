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
GIF and WebP are accepted. Metadata such as EXIF camera data and GPS
location, which would otherwise be exported with the card, is not stored:

- PNG and WebP files within 1280 px and 300 KiB keep their image data; only
  their metadata chunks (EXIF, XMP, text, time) are removed, so transparency
  and animation (APNG, animated WebP) stay. One whose EXIF orientation
  rotates it is re-encoded instead, so it is stored the way it shows.
- GIFs within those limits are kept unchanged so they stay animated (GIF has
  no EXIF; comment and XMP blocks, if any, stay).
- Every other image is redrawn and re-encoded, scaled to at most 1280 px and
  300 KiB: JPEG files as JPEG; images with transparency as PNG or WebP at
  each size, falling back to JPEG on white only if none fits; other images
  as PNG, then JPEG. Animated images re-encoded this way become still.

Images are
decoded at their original size before scaling, so a very large photo briefly
needs memory for its full pixels. An
image is not added if the document would exceed 7.5 MiB (hosts such as Stair
reject documents above 8 MiB); the panel shows an error, and a warning above
6 MiB. The same limit applies to the whole editor: a paste or duplicate that
would take the document past 8 MiB (including plain text pasted onto a node)
is refused with a notice. The paste is applied, the saved document measured,
and an oversized result rolled back with its history, so nesting and renewed
card IDs are counted. Images that a paste reads asynchronously are not
covered by this check. After any
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
a copy. Deleting the pasted node does not end the move: the cut source is
still gone, so pasting again brings the same ID back, like undoing the delete.
The ID is renewed only when the source is back, the cut has left the undo
history, the document was swapped, or a card with that ID is already on the
board. A card ID therefore never leaves the document it was made in, so undo
and redo in either document can never make two documents share a GUID. Nothing
is stored outside the document for this.

The editor keeps card IDs unique within a document. Duplicates (for example
from older versions or upstream Drawnix, which copy cards unchanged) are
repaired after loading, after the host replaces the document, and after every
change: the first card in document tree order keeps its ID, later ones get an
ID derived from the node ID and the duplicated ID, so the same data is always
repaired the same way. Tree order is the only evidence available, so if a copy
was pasted *before* the original, the copy keeps the ID and the original gets
the derived one; Anki then updates the copy's note and its review history
follows the copy. Hosts that care can compare `readAnkiCards()` with their
last export to see what changed. The repair is written to the document without an undo
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

**Pending card images.** Card images are processed asynchronously. A batch the
panel accepted keeps running after the panel closes or shows another node: the
image lands on the card it was added to, as one undo step, and is dropped only
if the document was swapped or the target card no longer exists. Because
`onValueChange` fires only when a batch commits, hosts must await
`editor.waitForPendingCardImages()` (bounded, default 10 s) before flushing a
save for close, window close, or a switch to another file, or an image the
user just added can be missing from the saved document. The wait returns
`'idle'` when every accepted batch settled, or `'timeout'` when the bound
elapsed with work still pending — on timeout, save what `serialize()` already
has and warn the user. After the wait (and after unmount), call `serialize()`
again rather than relying only on a snapshot from `onValueChange`: a batch
accepted before close still commits onto the board, but the change callback
may already have been detached.

The host owns storage, save scheduling, conflict detection, permissions, and
any Agent transport. This package has no Stair, Electron, Project, or session
dependency. Use `onViewportChange` and `onThemeChange` to persist presentation
changes as well.

`DrawnixEditor` exposes only:

- `serialize(): string` — current native document, including notes and theme.
- `readMindmap(): MindmapNode[]` — node IDs, topics, optional notes, and children.
- `readAnkiCards(): MindmapAnkiCardNode[]` — every node with Anki cards (see above).
- `waitForPendingCardImages(timeoutMs?): Promise<'idle' | 'timeout'>` — resolves
  once every card image batch accepted so far has committed or been refused,
  or after `timeoutMs` (default 10 s). Returns `'idle'` when the queue is
  clear, `'timeout'` when the bound elapsed with work still pending. Await it
  before saving on close or switching documents, then call `serialize()` for
  the value to persist: `onValueChange` fires only after a batch commits, and
  may already be detached after unmount even though the board holds the image.
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
be checked for preservation before relying on round trips. Cutting nodes also
adds an `ankiCardsCut` marker to those elements so a paste in this editor can
tell a cut from a copy; it is removed when pasting here, but pasting into
upstream Drawnix or another app keeps the (harmless) marker in that file.

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
checkout or a developer's `npm link`. Plait (`@plait/*` ~0.92.3,
`@plait-board/react-board` and `react-text` 0.4.0-2) and Slate are peer
dependencies: the host installs them, so there is exactly one copy of each.
Plait keeps board state in module-level WeakMaps, and a second copy would
break it. npm 7+ installs missing peers automatically.

The `./editor` entry is ESM only, because Plait ships only ESM. Import it
from ESM, or from CommonJS on Node 20.19+ / 22.12+ (`require()` of ESM).
The main entry keeps its CommonJS build for bundlers.

Manual acceptance: create a node, add multiline notes, close/reopen the panel,
rename and duplicate the node, remove a note and undo/redo, export/import the
file, and reload the page. Verify the same flows in the embedded host.

Document commands adapted from `build-my-work/stair` retain their Apache-2.0
license; see `LICENSES/stair-Apache-2.0.txt`. Upstream Drawnix retains its MIT
license.
