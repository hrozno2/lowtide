# Low Tide

A fast, minimal novel writing app for macOS, Windows and Linux — built to feel
that stays out of the way. Plain text in, manuscript out.

Your document is always a plain `.fountain` / `.txt` / `.md` file. Nothing is
locked in a database, and the markup stays readable in any other editor.

<img src="build/icon.png" width="128" alt="Low Tide">

![The editor](docs/screen-layout.png)

The writing view, with the navigator on the left and the view switch floating
over the text.

![Outline beside the pages](docs/screen-outline-pages.png)

The outline stays open beside the manuscript in either view.

## Running it

```bash
npm install
npm start
```

`npm start` bundles the renderer and launches the app. Use `npm run watch` in a
second terminal if you are editing renderer source.

## Building installers

```bash
npm run dist:mac      # .dmg + .zip          (arm64 + x64)
npm run dist:win      # NSIS installer       (x64 + arm64)
npm run dist:linux    # AppImage, pacman, tar.gz
```

On Arch and Arch-based distributions (CachyOS, EndeavourOS, Manjaro) install the
pacman package directly:

```bash
sudo pacman -U "Low Tide-1.0.0-linux-x64.pacman"
```

The AppImage needs no installation — mark it executable and run it.

Each command must run on (or cross-compile from) a host that has that
platform's toolchain — the usual approach is a CI matrix, or Docker for the
Linux targets. `npm run pack` produces an unpacked build for the current
platform, which is the quickest way to sanity-check packaging.

## The markup

Everything is one column of plain text. Markup characters stay visible but dim,
so the document never reflows while you type.

| You write | You get |
| --- | --- |
| `# Chapter One` | Chapter — appears in the Navigator |
| `## Scene` / `### Beat` | Section, sub-section |
| `**bold**` `*italic*` `***both***` | Emphasis |
| `_underline_` `~~struck~~` | Underline, strikethrough |
| `[[a note to self]]` | Note — never printed, never counted |
| `/* … */` | Comment — hidden from the manuscript |
| `---` or `===` | Page break |
| `***` | Scene break (prints as `#`) |
| `> centered <` | Centered line |
| `> flush right` | Right aligned |
| `- item` | Bulleted list with a hanging indent |

A `Key: Value` block at the very top of the file (`Title:`, `Author:`,
`Draft date:`, `Contact:`) becomes the title page and is excluded from the word
count.

## Keyboard

| | |
| --- | --- |
| `⌘/Ctrl 1 2 3` | Chapter, Section, Sub-section |
| `⌘/Ctrl 0` | Back to body text |
| `⌘/Ctrl B I U` | Bold, italic, underline |
| `⇧⌘/Ctrl C` | Centre the line |
| `⇧⌘/Ctrl N` | Wrap in a note |
| `⇧⌘/Ctrl B` / `⇧⌘/Ctrl P` | Scene break / page break |
| `⇧⌘/Ctrl L` | Navigator |
| `⇧⌘/Ctrl E` | Preview |
| `⇧⌘/Ctrl F` | Focus Mode |
| `⇧⌘/Ctrl T` | Typewriter scrolling |
| `⇧⌘/Ctrl R` | Sprint |
| `⇧⌘/Ctrl K` | Scratchpad |
| `⇧⌘/Ctrl V` | New revision |
| `⇧⌘/Ctrl H` | Home |
| `⌘/Ctrl T` | Editor theme |
| `⌘/Ctrl J` | Jump to a chapter |
| `⌘/Ctrl F` | Find |
| `⌥⌘F` / `Ctrl H` | Find and replace |
| `⌘/Ctrl G` / `⇧⌘/Ctrl G` | Find next / previous |
| `⇧⌘/Ctrl U` | Outline pane |
| `⇧⌘/Ctrl D` | Dictionary and thesaurus |
| `⇧⌘/Ctrl M` | Music pane |
| `⌘/Ctrl E` | Export |
| `⌘/Ctrl P` | Export straight to PDF |
| `F1` | Markup cheat sheet |

## What's in it

- **Home** — a start window with recent documents, templates and a sample.
  `⇧⌘/Ctrl H` brings it back at any time.
- **Live styling** — headings, emphasis, notes and comments are styled as you
  type; the file on disk stays plain text.
- **Navigator** — chapters and sections with per-section word counts, a live
  filter, and click-to-jump.
- **Goals** — one goal at a time, in new words, new pages, total words or total
  pages. Meet it and the ring turns; press Done to log it to the history and set
  the next one.
- **Statistics** — pages, reading time, words, characters and selection counts.
- **Real pagination** — the page count is measured by laying the manuscript out
  at print geometry, not estimated from a words-per-page figure, and the preview
  is split at exactly those breaks (paragraphs continue across pages).
- **Themes** — nine editor themes, light and dark, from the palette picker.
- **View switch** — text and pages live on a small control floating over the
  writing area, which fades in as the pointer approaches and out again when it
  leaves. The outline sits beside it as its own button.
- **Outline pane** — a second editor beside the manuscript, opened and closed
  with one button and resizable by dragging its edge, so you can write the story
  and its plan at once. A new outline starts from a template: three-act, Dan
  Harmon's story circle, the hero's journey, seven-point, Freytag, a chapter
  grid, or blank. Each outline belongs to its document, and stays open in both
  the text view and the pages view — the pages shrink to fit whatever width is
  left.
- **Configurable toolbar** — the buttons at the top right can be reordered and
  switched off in Preferences. Preferences itself always stays.
- **Dictionary and thesaurus** — in the left pane with the other text tools;
  look up definitions, synonyms and antonyms, and click a synonym to swap it
  into the manuscript. On macOS the
  system dictionary is one click away and works offline.
- **Music** — play audio files from your machine in the side pane, or browse
  YouTube in it. YouTube runs as an ordinary page in a separate process, with
  its own search, scaled down to suit a narrow pane and adjustable from the
  pane itself. It can be switched off completely in Preferences.
- **Find and replace** — `⌘/Ctrl F` to find, `⌥⌘F` (`Ctrl H` on Windows and
  Linux) to replace, with find next/previous and replace all.
- **Spelling** — right-click a misspelling for corrections and "Add to
  Dictionary". macOS uses the system spellchecker; elsewhere you pick which
  dictionaries to download in Preferences.
- **Revisions** — name and colour a revision; everything you type while it is
  selected is marked in that colour. Marks follow the text through later edits.
  Each revision can be hidden, applied (keep the text, drop the colour),
  reverted (delete what it added) or removed from the list.
- **Scratchpad** — per-document notes that are never printed or counted.
- **Focus Mode** — dims everything except the current paragraph or line.
- **Typewriter scrolling** — keeps the caret vertically centred.
- **Sprint** — a countdown with an optional word goal, tracked in the footer.
- **Preview and export** — manuscript pages with running heads, and an export
  button for PDF, Word (`.docx`), Markdown, plain text and HTML. The Word file
  is written directly rather than being HTML in disguise, so headings, bold,
  italics, indents, page breaks and an optional title page all survive.
- **Smart punctuation** — curly quotes, em dashes and ellipses as you type.
- **Dropbox** — `File ▸ Move to Dropbox` moves the open document into a Low Tide
  folder inside Dropbox (carrying its scratchpad and revisions with it), new
  documents can default to saving there, and the status bar says when a document
  lives inside Dropbox.

Preferences (`⌘/Ctrl ,`) cover typeface, size, line spacing, column width,
paragraph style, focus scope, spelling, the page template (size, margins, type
size, leading, justification), reading speed and the daily goal.

## Not losing work

- Files are written to a temp file and then renamed over the original, so a
  crash or a full disk cannot leave a half-written manuscript.
- Autosave runs 1.4 s after you stop typing, at least every 15 s while you keep
  going, and whenever the window loses focus.
- Every save keeps the version it replaced. `File ▸ Revert to Backup` lists the
  last 40 for the document and opens the one you pick in a new window, so the
  document you are working on is never overwritten by a restore.
- Unsaved drafts live in the session store and come back on next launch.

## Layout of the source

```
src/main/       Electron main process: windows, menus, file IO, PDF export
src/preload/    contextBridge API surface
src/renderer/
  js/markup.js       the grammar — line types, inline spans, word counting
  js/decorations.js  CodeMirror plugin that paints the grammar live
  js/parse.js        outline, preview pages, print HTML, front matter
  js/editor.js       CodeMirror setup, formatting commands, smart punctuation
  js/pagination.js   measures the print layout and cuts real pages
  js/revisions.js    coloured revision marks that survive later edits
  js/themes.js       nine themes, derived from six colours each
  js/home.js         the Home window
  js/outlines.js     the starter outline structures
src/main/docx.js     writes .docx files without a dependency
  js/app.js          wiring: state, navigator, stats, sprint, preview, files
  css/theme.css      the palette tokens (themes overwrite these at runtime)
src/main/backups.js  atomic writes and the rolling version store
src/main/templates.js  starter documents offered by Home
scripts/        build, screenshot, icon and test utilities
```

## Tests

```bash
npm test          # both suites
npm run test:unit # 93 parser, document and Word-file checks, no browser needed
npm run test:app  # 171 end-to-end checks driving the real app
```

The end-to-end suite boots the app, opens a document from Home, and drives it
through the same IPC and DOM a person would touch: formatting commands, undo,
smart punctuation, counting, the navigator and its filter, pagination and the
split preview, every theme, goals from set to done to history, revisions
(including hide, apply, revert, and that marks survive a reload), the
scratchpad, autosave to disk, backup creation, atomic writes, exports, Home
data, Dropbox detection, chapter jumping, find and replace, the outline pane and
its templates, the music pane and its YouTube switch, the view toggles and
sprints.

## Licence

Low Tide is MIT licensed — see `LICENSE`. Everything it bundles is permissively
licensed too, and `THIRD-PARTY-NOTICES.md` (regenerate with `npm run notices`)
carries the full text:

- CodeMirror and its supporting packages — MIT
- Electron, esbuild, electron-builder — MIT. Electron embeds Chromium and
  Node.js under their own terms; packaged builds include `LICENSES.chromium.html`.
- Courier Prime — SIL Open Font License 1.1. It is redistributed unmodified,
  with `src/renderer/fonts/OFL.txt` alongside it. The OFL applies to the font
  only, not to this software.

Every icon, style and string in Low Tide was written for this project; it is
not derived from any other application's code or assets. The Fountain markup it
reads is an open syntax.

## Notes and limitations

- The PDF's running head is drawn by Chromium's print engine, which applies it
  to every page — including the title page when that option is on. In-document
  headers can't repeat across Chromium's own page breaks, so this is the
  trade-off; the on-screen preview shows headers exactly per page.
- Dropbox integration works through the Dropbox folder, not the Dropbox API.
  Documents sync because the desktop client syncs them. There is no in-app
  account, no second copy of the file, and no conflict resolution of our own —
  which also means nothing to break if Dropbox is not installed.
- Revision marks and scratchpads are stored beside the document in the app's
  own data, keyed by file path, so the manuscript file stays plain text. Moving
  a document leaves them behind.
- Word counting treats hyphenated words as two and contractions as one, and
  excludes notes, comments and title-page metadata.
- The dictionary and thesaurus query dictionaryapi.dev and datamuse.com. Only
  the single word is sent, the request is made by the main process rather than
  the editor, and the whole feature can be switched off in Preferences.
- The music pane shows YouTube's own site in a browser view. Stripping the
  picture to take only the audio is against YouTube's terms of service, so the
  app does not do it; play local files instead if you want sound with nothing to
  look at. YouTube can be disabled entirely.
- There is no Spotify tab. Its web player needs Widevine DRM, which Electron
  does not ship, so the tab would load but never play. Use the Spotify desktop
  app alongside, or the music pane's local files.
- Courier Prime is bundled under the SIL Open Font License; see
  `src/renderer/fonts/OFL.txt`.
