<p align="center">
  <img src="build/icon.png" width="140" alt="Low Tide">
</p>

<h1 align="center">Low Tide</h1>

<p align="center">A novel writing app that keeps you in the room.</p>

Writing goes wrong when you leave to look something up. You open a browser for a
synonym, glance at your outline in another window, put music on — and the thread
is gone. Low Tide puts all of it inside the app: your outline beside the page, a
dictionary and thesaurus in the sidebar, music in a pane, notes where you're
working. Nothing asks you to tab away.

The name is the promise. The tide is out; there's no water here to fall into.

Your document stays a plain `.fountain`, `.txt` or `.md` file the whole time.
No database, no lock-in, readable in any other editor.

![The editor](docs/screen-layout.png)

## Install

### Download

Take the file for your machine from
[Releases](https://github.com/hrozno2/lowtide/releases).

| System | File |
| --- | --- |
| macOS, Apple silicon | `LowTide-‹version›-mac-arm64.dmg` |
| macOS, Intel | `LowTide-‹version›-mac-x64.dmg` |
| Windows | `LowTide-‹version›-win-x64.exe` |
| Linux, any distro | `LowTide-‹version›-linux-x86_64.AppImage` |
| Arch, CachyOS, Manjaro | `LowTide-‹version›-linux-x64.pacman` |

- **macOS** — open the `.dmg`, drag it to Applications.
- **Windows** — run the `.exe`.
- **AppImage** — `chmod +x` it and run it. Nothing to install.
- **Arch** — `sudo pacman -U LowTide-‹version›-linux-x64.pacman`

The builds are not notarised, so the first launch needs a nudge: on macOS
right-click the app and choose **Open** (double-clicking will refuse); on
Windows choose **More info → Run anyway**.

### Or build it

```bash
git clone https://github.com/hrozno2/lowtide.git
cd lowtide
npm install
npm start
```

To make installers yourself:

```bash
npm run dist:mac      # .dmg                   (Apple silicon + Intel)
npm run dist:win      # installer              (x64 + arm64)
npm run dist:linux    # AppImage, pacman
```

Each has to run on that platform, or in CI.

## What's in it

**Writing.** Plain text with live styling — headings, emphasis, notes and
comments are coloured as you type, and the markup characters stay visible so the
page never reflows under your hands. Smart quotes, em dashes and ellipses.
Spellcheck with right-click corrections; choose your dictionaries in Preferences.

**Search.** The magnifying glass (or ⌘K) finds anything: a setting, a place
in the app — the scratchpad, the outline, themes, the pages view — or a menu
command, and choosing it goes there. It forgives typos, knows that *colour*
means Themes and *pomodoro* means the sprint, and when nothing matches it
offers the words it thinks you meant. Preferences itself is six folding
sections. Hold a toolbar button until the row shakes, then drag it to reorder.

**Structure.** The Navigator lists every chapter and section with its word
count, filters as you type, and jumps you there. Nesting is drawn with one rule
per level, and dragging a chapter reorders the manuscript — the text goes with
it, scenes and all.

**Outline.** A second editor beside the manuscript, opened and closed with one
button and resizable by dragging. Start from three-act, Dan Harmon's story
circle, the hero's journey, seven-point, Freytag, a chapter grid, or blank. Each
outline belongs to its document and stays open in both the text and pages views.

![The outline open beside the finished pages](docs/screen-outline-pages.png)

**Pages.** The pages view sets the manuscript the way Highland's Novel
template does, measured from a PDF it produced: Amiri at 13pt on 20.8pt lines
in a 5.35in column, an inch above and below, a centred running head, each
chapter opening 2.7in down the page and flowing on rather than forcing a new
one. On the same manuscript it gives the same page count, and the same page
breaks to the line for as long as Highland's own paginator holds a steady 33
lines. Amiri is bundled, so the page is the same on macOS, Windows and Linux,
and the PDF embeds it. Letter or A4 follows your region; book trims, margins,
type size, leading, justification and hyphenation are in Preferences, with a
Reset. Page markers, off by default, show where each printed page begins in
the margin of the writing view. Zoom the pages with ⌘+ and ⌘−, ⌘-scroll, or the −/+ under them; ⌘0 fits
the page. The PDF is the preview, at the trim you chose.

**Reference.** Definitions, synonyms and antonyms in the sidebar. Click a
synonym to swap it into your prose. On macOS the system dictionary is one click
away and works offline.

![Synonyms in the sidebar](docs/screen-reference.png)

**Sound.** Play audio files from your machine, or browse YouTube in a pane,
repainted in your theme with the comments, likes, recommendations and shorts
stripped out, which leaves the search box and the player. Closing the pane
hides it rather than stopping it, so whatever is playing keeps playing.
YouTube can be switched off entirely.

**Scratchpad.** Notes about the document, kept with it, never printed or counted.

**Revisions.** Name and colour a revision; everything you type while it is
selected is marked in that colour, and the marks follow the text through later
edits. Any revision can be hidden, applied (keep the text, drop the colour),
reverted (delete what it added), or removed.

![Text marked by a revision](docs/screen-revisions.png)

**Goals and stats.** One goal at a time — new words, new pages, total words or
total pages. Meet it, press Done, and it drops into the history. Alongside it:
pages, reading time, words, characters, and counts for whatever is selected.
Sprints run a countdown with an optional word goal.

![The goal ring and document statistics](docs/screen-stats.png)

**Focus.** The focus button opens a small panel over the toolbar: dim
everything but where you are, choose whether the paragraph or the line stays
lit, and say whether the notes in your text are picked out in colour or dimmed
until you want them. Typewriter scrolling keeps the caret centred — the caret
only, so selecting with the mouse is left alone.

**Notes to yourself.** `[[a note in double brackets]]` and `/* a comment
block */` sit in the manuscript without ever being counted or printed. They
take a colour of their own from the theme, and dim out of the way when you
would rather not see them.

**Preview and export.** Real page breaking — the manuscript is laid out
offscreen at print geometry and cut where the lines actually fall, so the page
count is the true one. Export to PDF, Word (`.docx`, written directly rather
than HTML in disguise), Markdown, plain text or HTML, with an optional title
page.

**Nothing gets lost.** Saves are atomic, so a crash cannot truncate your file.
It saves as you write — silently, with nothing to dismiss — when you pause and
at least every fifteen seconds while you keep going; both the switch and the
interval are in Preferences. A version of the manuscript is kept every few
minutes and whenever the file is saved over, and `File ▸ Version History` opens
any of them in a new window, the current document untouched. The store holds
every recent version and a day's last beyond those, so a history outlives the
week it was written in; it lives beside your settings, not in the app, so
updating never touches it, and versions kept before you moved or renamed a
manuscript are listed with it. Unsaved drafts survive a restart.
`File ▸ Move to Dropbox` moves a document into Dropbox with its outline,
scratchpad and revisions intact.

**Updates.** On launch it asks GitHub whether a newer release exists and, if so,
shows a dismissible notice with a download link. It never installs anything by
itself, and the check can be switched off in Preferences.

**Out of the way.** Preferences, export, themes, the sprint timer and the rest
open as a panel down the right and the text moves over to make room, so nothing
ever covers the line you are writing. Every theme is checked against WCAG
contrast ratios, so all of them are readable rather than only most of them.

**Make it yours.** Ten themes, light and dark. Typeface, size, line spacing,
column width, page size, margins and print leading are all adjustable, and the
toolbar buttons can be reordered or switched off. On Windows and Linux the menu
is either a button in the title bar or written out along it, whichever you
prefer — drawn in the theme either way rather than in the system's colours.
The taskbar/dock icon follows along too, its mark recoloured to match.

![Ten themes, light and dark](docs/screen-themes.png)

## The markup

| You write | You get |
| --- | --- |
| `# Chapter One` | Chapter — appears in the Navigator |
| `## Scene` / `### Beat` | Section, sub-section |
| `**bold**` `*italic*` `***both***` | Emphasis |
| `_underline_` `~~struck~~` | Underline, strikethrough |
| `[[a note to self]]` | Note — never printed, never counted |
| `/* … */` | Comment — hidden from the manuscript |
| `===` | Page break |
| `***` or `---` | Scene break |
| `> centered <` | Centered line |
| `- item` | Bulleted list |

A `Key: Value` block at the top of the file (`Title:`, `Author:`,
`Draft date:`) becomes the title page and is left out of the word count.

## Keyboard

| | |
| --- | --- |
| `⌘/Ctrl 1 2 3` | Chapter, Section, Sub-section |
| `⌘/Ctrl B I U` | Bold, italic, underline |
| `⇧⌘/Ctrl C` | Centre the line |
| `⇧⌘/Ctrl N` | Wrap in a note |
| `⌘/Ctrl F` | Find |
| `⌥⌘F` / `Ctrl H` | Find and replace |
| `⌘/Ctrl J` | Go to chapter |
| `⇧⌘/Ctrl L` | Navigator |
| `⇧⌘/Ctrl U` | Outline |
| `⇧⌘/Ctrl D` | Dictionary and thesaurus |
| `⇧⌘/Ctrl M` | Music |
| `⇧⌘/Ctrl E` | Pages view |
| `⌘/Ctrl K` | Search everything |
| `⇧⌘/Ctrl F` | Focus Mode |
| `⇧⌘/Ctrl T` | Typewriter scrolling |
| `⇧⌘/Ctrl R` | Sprint |
| `⌘/Ctrl E` | Export |
| `F1` | Markup cheat sheet |

## Notes

- Page counts come from a real layout rather than a words-per-page guess. Page
  size, margins, type size and leading are all adjustable.
- The PDF's running head is drawn by Chromium's print engine, which puts it on
  every page, including a title page. The on-screen preview is exact.
- The dictionary queries dictionaryapi.dev and datamuse.com. Only the single
  word is sent, the request comes from the main process rather than the editor,
  and the feature can be switched off.
- The music pane shows YouTube's own site, with its palette overridden to match
  the current theme. Taking only the audio is against their terms, so it is not
  done; use local files if you want sound with nothing to look at. There is no
  Spotify tab — its web player needs DRM that Electron does not ship.

## Development

```bash
npm run watch       # rebuild the renderer as you edit
npm test            # 119 unit and 439 end-to-end checks
npm run pack        # unpacked build, the quickest packaging check
```

```
src/main/          windows, menus, file IO, PDF and Word export
src/renderer/js/   markup, decorations, pagination, parse, editor, app
src/renderer/css/  theme.css holds every palette token
```

## Licence

MIT — see `LICENSE`. Everything bundled is permissively licensed, with the full
text in `THIRD-PARTY-NOTICES.md`. CodeMirror, Electron, esbuild and
electron-builder are MIT; Courier Prime and Amiri are under the SIL Open Font
License, Amiri subset to the Latin ranges.

Every icon, style and string here was written for this project; it is not
derived from any other application's code or assets. Fountain is an open syntax.
