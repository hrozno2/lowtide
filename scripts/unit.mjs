/* Pure-function tests for the markup and document layers.
   node scripts/unit.mjs   (bundles the ESM sources first) */
import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const out = join(tmpdir(), `low-tide-units-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: ['scripts/unit-entry.js'],
  bundle: true, format: 'esm', outfile: out, logLevel: 'error'
});
const M = await import(out);

const require_ = createRequire(import.meta.url);
let pass = 0;
const failures = [];
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass++;
  else failures.push(`${name}\n    got:  ${a}\n    want: ${b}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ---------------------------------------------------------- theme contrast */
import { THEMES, paletteFor, contrast } from '../src/renderer/js/themes.js';

const CONTRAST_CHECKS = [
  ['--text', '--bg', 4.5], ['--text', '--surface', 4.5],
  ['--text-2', '--surface', 4.5], ['--text-2', '--surface-2', 4.5],
  ['--text-3', '--surface', 3.0], ['--text-3', '--surface-2', 3.0],
  ['--text-4', '--surface', 3.0], ['--text-4', '--surface-2', 3.0],
  ['--primary', '--bg', 4.5], ['--primary-2', '--bg', 4.5],
  ['--note', '--bg', 4.5], ['--rule', '--bg', 4.5],
  ['--stat', '--surface', 3.0], ['--caret', '--bg', 3.0],
  ['--on-primary', '--primary', 4.5]
];

for (const theme of THEMES) {
  const p = paletteFor(theme.id);
  const failures = CONTRAST_CHECKS
    .filter(([fg, bg, min]) => contrast(p[fg], p[bg]) < min)
    .map(([fg, bg, min]) => `${fg} on ${bg} = ${contrast(p[fg], p[bg]).toFixed(2)} (needs ${min})`);
  eq(`${theme.name}: every piece of text is readable`, failures, []);
}

/* ------------------------------------------------------------- line types */
const type = (t) => M.classifyLine(t).type;
eq('empty line', type(''), 'blank');
eq('whitespace only', type('   \t '), 'blank');
eq('heading level 1', M.classifyLine('# One').level, 1);
eq('heading level 4', M.classifyLine('#### Four').level, 4);
eq('five hashes is not a heading', type('##### Five'), 'body');
eq('hash without space is body', type('#Nope'), 'body');
// A line of nothing but hashes is a heading whose title is not typed yet, so
// that editing the hashes of a heading does not collapse the line to body
// height and spring it back as the title is retyped.
eq('hash alone is a heading', type('#'), 'heading');
eq('two hashes alone is a heading', type('##'), 'heading');
eq('hashes alone keep their level', M.classifyLine('###').level, 3);
eq('hashes alone have no title', M.classifyLine('##').title, '');
eq('five hashes alone is still body', type('#####'), 'body');
eq('heading title trimmed', M.classifyLine('##   Spaced   ').title, 'Spaced');
eq('centered', type('> middle <'), 'center');
eq('right aligned', type('> later'), 'right');
eq('lone > is body', type('>'), 'body');
eq('page break equals', type('==='), 'pagebreak');
eq('dashes are a scene divider, as in Highland', type('---'), 'divider');
eq('two dashes is body', type('--'), 'body');
eq('divider stars', type('***'), 'divider');
eq('bullet list', type('- item'), 'list');
eq('numbered list', type('12. item'), 'list');
eq('dash without space is body', type('-item'), 'body');
eq('italic line is not a list', type('*italic* start'), 'body');
eq('list marker width', M.classifyLine('- x').markerTo, 2);
eq('numbered marker width', M.classifyLine('10. x').markerTo, 4);

/* ---------------------------------------------------------------- inline */
const spans = (t) => { const o = []; M.scanInline(t, (a, b, c) => o.push([t.slice(a, b), c])); return o; };
eq('bold', spans('a **b** c'), [['**','m-marker'],['b','m-bold'],['**','m-marker']]);
eq('italic', spans('*i*'), [['*','m-marker'],['i','m-italic'],['*','m-marker']]);
eq('bold italic', spans('***x***'), [['***','m-marker'],['x','m-bolditalic'],['***','m-marker']]);
eq('underline', spans('_u_'), [['_','m-marker'],['u','m-underline'],['_','m-marker']]);
eq('strike', spans('~~s~~'), [['~~','m-marker'],['s','m-strike'],['~~','m-marker']]);
eq('unmatched opener is literal', spans('a * b'), []);
eq('arithmetic is untouched', spans('3 * 4 * 5'), []);
eq('escaped star', spans('\\*not*'), []);
eq('note', spans('[[hi]]'), [['[[','m-note m-note-marker'],['hi','m-note'],[']]','m-note m-note-marker']]);
eq('unclosed note is literal', spans('[[open'), []);

/* ----------------------------------------------------------------- words */
eq('empty doc', M.countWords(''), 0);
eq('simple', M.countWords('one two three'), 3);
eq('notes excluded', M.countWords('a [[skip this]] b'), 2);
eq('comments excluded', M.countWords('a /* skip this */ b'), 2);
eq('unterminated comment eats rest', M.countWords('a /* b c'), 1);
eq('markup not counted', M.countWords('**bold** *it*'), 2);
eq('heading marker not counted', M.countWords('# Chapter One'), 2);
eq('contractions are one word', M.countWords("it's fine"), 2);
eq('accents count', M.countWords('café niño'), 2);
eq('em dash splits', M.countWords('one—two'), 2);
eq('a hyphen separates two words', M.countWords('well-known'), 2);
eq('list dash is not a word', M.countWords('- item\n- other'), 2);
eq('contraction is one word', M.countWords("don't stop"), 2);
eq('leading apostrophe does not start a word', M.countWords("'tis done"), 2);
eq('dash alone is not a word', M.countWords('a - b'), 2);

/* ----------------------------------------------------------- front matter */
eq('front matter parsed', M.frontMatter('Title: A\nAuthor: B\n\n# One').meta, { title: 'A', author: 'B' });
eq('prose colon is not front matter', M.frontMatter('She said: hello').meta, {});
eq('body offset', M.frontMatter('Title: A\n\n# One').bodyOffset, 10);
eq('no front matter offset', M.frontMatter('# One').bodyOffset, 0);

/* --------------------------------------------------------------- outline */
const out1 = M.outline('# A\n\nword word\n\n## B\n\nword\n');
eq('outline length', out1.length, 2);
eq('outline titles', out1.map((i) => i.title), ['A', 'B']);
eq('outline levels', out1.map((i) => i.level), [1, 2]);
eq('section word counts exclude the heading', out1.map((i) => i.words), [2, 1]);
eq('outline of empty doc', M.outline('').length, 0);

/* ----------------------------------------------------------------- pages */
const sec = (t, o) => M.pagesHtml(t, o);
eq('page break splits sections', sec('a\n\n===\n\nb').length, 2);
eq('a chapter head flows on, as Highland sets it', sec('# A\n\nx\n\n# B\n\ny').length, 1);
ok('but changes the running head', sec('# A\n\nx\n\n===\n\n# B\n\ny')[1].chapter === 'B');
// Every block also names the source line it came from, for the page markers.
ok('first paragraph is flush', /<p class="flush" data-line="\d+">one<\/p>/.test(sec('# A\n\none\n\ntwo')[0].html));
ok('second paragraph indents', /<p data-line="\d+">two<\/p>/.test(sec('# A\n\none\n\ntwo')[0].html));
ok('blocks record their line', sec('# A\n\none\n\ntwo')[0].html.includes('data-line="2"'));
ok('notes hidden by default', !sec('a [[note]] b')[0].html.includes('note'));
ok('notes shown when asked', sec('a [[note]] b', { notes: true })[0].html.includes('class="note"'));
ok('comments never printed', !sec('a /* secret */ b')[0].html.includes('secret'));
ok('html is escaped', sec('a < b & c')[0].html.includes('&lt;') && sec('a < b & c')[0].html.includes('&amp;'));
ok('list rendered', sec('- one')[0].html.includes('<p class="list" data-line='));
eq('chapter tracked on the page', sec('# Ch\n\nx')[0].chapter, 'Ch');

/* ------------------------------------------------------------------ print */
const html = M.printHtml('Title: T\nAuthor: A\n\n# One\n\nbody', { title: 'T' },
  { titlePage: true, template: { pageSize: 'a4', margin: 1.25, fontSize: 11, leading: 1.5, justify: false } });
ok('print uses A4', html.includes('size: A4'));
ok('print uses margin', html.includes('margin: 1.25in 1.25in 1.25in'));
ok('print uses type size', html.includes('font-size: 11pt'));
ok('print uses leading', html.includes('line-height: 1.5'));
ok('ragged when not justified', html.includes('text-align: left'));
ok('title page included', html.includes('title-page') && html.includes('>T<'));
ok('front matter not in body', !html.includes('Title: T'));
const book = M.printHtml('# One\n\nbody', {}, { template: { pageSize: '6x9', margin: 1, sideMargin: 0.8, fontSize: 11, leading: 1.42, hyphenate: true } });
ok('a book trim is given to the printer in inches', book.includes('size: 6in 9in'));
ok('side margins are their own number', book.includes('margin: 1in 0.8in 1in'));
ok('the title page is exactly the text box tall', book.includes('height: calc(9in - 2in)'));
ok('the print sets like the preview: italic chapter heads', /h1 \{[^}]*font-style: italic/.test(book));
ok('hyphenates when asked', /body \{[^}]*hyphens: auto/.test(book));
ok('and not otherwise', !/hyphens: auto/.test(M.printHtml('x', {}, {})));
ok('and the same paragraph indent', book.includes('text-indent: .25in'));
const dflt = M.printHtml('x', {}, {});
ok('the default page is A4, 13pt Amiri at 160%', dflt.includes('size: A4') && dflt.includes('font-size: 13pt') && dflt.includes('line-height: 1.6'));
ok('with Highland\'s margins', dflt.includes('margin: 1in 1.46in 1in'));
ok('set in the bundled face', /font-family: Amiri,/.test(dflt));
ok('an HTML export carries no font files', !dflt.includes('@font-face'));
const pdf = M.printHtml('x', {}, { fontBase: 'file:///app/fonts/' });
ok('a PDF gets the face by absolute URL', pdf.includes('src: url("file:///app/fonts/am-400.woff2")') && pdf.includes('am-italic-700.woff2'));

/* ------------------------------------------------------ search synonyms */

/* The table of words that reach a setting is one object literal, so a word
   written twice silently loses its first meaning: "notes" was written once
   for the note style and again for the scratchpad, and the note style became
   unreachable by the obvious word for it. */
{
  const src = readFileSync(join('src', 'renderer', 'js', 'panels.js'), 'utf8');
  const body = src.slice(src.indexOf('const RELATED = {'), src.indexOf('};', src.indexOf('const RELATED = {')));
  const keys = [...body.matchAll(/(?:^|[{,]\s*)([a-z0-9]+):\s*\[/g)].map((m) => m[1]);
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  eq('no word in the search synonyms is written twice', [...new Set(twice)], []);
  ok('and there are plenty of them', keys.length > 60);
}

/* --------------------------------------------------- colours in the sheets */

/* Every colour in the stylesheets has to come from the theme, or a theme that
   is not the default paints half its window in somebody else's palette — a
   blue theme was highlighting matching words in teal because the rule held
   Material's own accent. The exceptions below are the ones that genuinely do
   not follow the theme, with the reason they do not. */
const CSS_COLOUR_EXCEPTIONS = [
  // The preview is paper and ink, whatever colour the window is.
  '#f7f5f0', '#16191a', '#7a6a2a',
  // Revision marks are colours the writer picks by name.
  '#5aa9e6', '#f27eb2', '#e0b44c', '#7fc96b', '#e8934a', '#b08ae0', '#e8695f', '#4ec7b8',
  // The close button in the title bar, red the world over.
  '#c4342f', '#fff',
  // A veil over the window: black at low opacity, over light themes and dark.
  'rgba(0, 0, 0, .45)'
];

for (const file of ['app.css', 'editor.css', 'home.css']) {
  const css = readFileSync(join('src', 'renderer', 'css', file), 'utf8');
  const found = (css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])
    .filter((c) => !CSS_COLOUR_EXCEPTIONS.includes(c))
    .filter((c) => !/^rgba?\(\s*(var|from)/.test(c));
  eq(`${file} leaves every colour to the theme`, [...new Set(found)], []);
}

/* ------------------------------------------------------------ strip markup */
eq('strip heading', M.stripMarkup('# Chapter **One**'), 'Chapter One');
eq('strip list', M.stripMarkup('- a *b*'), 'a b');
eq('strip centered', M.stripMarkup('> mid <'), 'mid');
eq('strip note', M.stripMarkup('keep [[drop]]'), 'keep');

/* --------------------------------------------------------- structured doc */
const blocks = M.documentBlocks('Title: T\n\n# One\n\nfirst **bold** para\n\nsecond para\n\n- a beat\n\n===\n\n> centred <');
eq('front matter is not a block', blocks.some((b) => (b.runs || []).some((r) => r.text.includes('Title'))), false);
eq('heading block', blocks[0].type, 'h1');
eq('first paragraph is flush', blocks[1].indent, false);
eq('second paragraph indents', blocks[2].indent, true);
ok('bold survives as a run', blocks[1].runs.some((r) => r.bold && r.text === 'bold'));
ok('markers are gone', !blocks[1].runs.some((r) => r.text.includes('**')));
eq('list block', blocks[3].type, 'list');
eq('page break block', blocks[4].type, 'pagebreak');
eq('centred block', blocks[5].type, 'center');
eq('notes are dropped by default',
   M.documentBlocks('a [[note]] b')[0].runs.map((r) => r.text).join(''), 'a  b');
ok('notes can be kept',
   M.documentBlocks('a [[note]] b', { notes: true })[0].runs.some((r) => r.text === 'note'));

/* ----------------------------------------------------------------- docx */
const { buildDocx } = require_('../src/main/docx.js');
const docx = buildDocx(
  [{ type: 'h1', runs: [{ text: 'Chapter' }] },
   { type: 'p', runs: [{ text: 'text with < & >' }, { text: ' bold', bold: true }] },
   { type: 'pagebreak' }],
  { title: 'T', author: 'A' },
  { titlePage: true, leading: 1.8, fontSize: 12, margin: 1, justify: true });

ok('docx is a zip', docx.slice(0, 2).toString('latin1') === 'PK');
ok('docx has an end-of-central-directory record', docx.slice(-22, -18).toString('latin1') === 'PK\u0005\u0006');
const asText = docx.toString('latin1');
ok('docx declares the main document part', asText.includes('word/document.xml'));
ok('docx ships styles', asText.includes('word/styles.xml'));
ok('docx escapes markup characters', asText.includes('&lt; &amp; &gt;'));
ok('docx carries the title page', asText.includes('>T<'));

/* -------------------------------------------------------------- updates */
const U = require_('../src/main/updates.js');
eq('a newer patch wins', U.compareVersions('1.0.1', '1.0.0'), 1);
eq('equal versions tie', U.compareVersions('1.0.0', '1.0.0'), 0);
eq('an older version loses', U.compareVersions('0.9.9', '1.0.0'), -1);
eq('a leading v is ignored', U.compareVersions('v1.2.0', '1.1.9'), 1);
eq('a release beats its own pre-release', U.compareVersions('1.0.0', '1.0.0-beta'), 1);
eq('a pre-release loses to the release', U.compareVersions('1.0.0-beta', '1.0.0'), -1);
eq('missing parts count as zero', U.compareVersions('1.0', '1.0.0'), 0);
eq('major beats minor', U.compareVersions('2.0.0', '1.9.9'), 1);
eq('nonsense is treated as equal', U.compareVersions('not-a-version', '1.0.0'), 0);
eq('the repository is found', U.repoSlug({ repository: { url: 'https://github.com/hrozno2/lowtide.git' } }), 'hrozno2/lowtide');
eq('a missing repository is null', U.repoSlug({}), null);

/* ------------------------------------------------------------- darlings */

/* A darling goes home by the words around it. These are the ways a
   manuscript changes under one between the cut and putting it back. */
{
  const NOVEL = [
    '# One',
    '',
    'The lamp had been burning for ninety-one years. She counted the steps because her father had counted them. At the top the light turned in its slow circle.',
    '',
    '# Two',
    '',
    'Nobody had thought to give it a name, and the number was a kind of prayer.'
  ].join('\n');

  // the middle sentence of the first paragraph
  const from = NOVEL.indexOf('She counted');
  const to = NOVEL.indexOf('At the top');
  const d = M.cutFrom(NOVEL, from, to, { now: 1700000000000 });

  eq('a darling knows its chapter', d.chapter, 'One');
  eq('and counts its own words', d.words, 10);
  ok('it keeps the words before the cut', NOVEL.slice(0, from).endsWith(d.before));
  ok('and the words after', NOVEL.slice(to).startsWith(d.after));

  const cut = NOVEL.slice(0, from) + NOVEL.slice(to);
  const home = M.homeFor(cut, d);
  eq('it goes straight home in text nobody touched', home.at, from);
  ok('and is sure of it', home.sure);
  eq('putting it back gives the manuscript it came from',
     cut.slice(0, home.at) + M.restoreText(cut, home.at, d.text) + cut.slice(home.at), NOVEL);

  // a line added above moves every offset and must not matter
  const added = '# Nought\n\nA new first chapter entirely.\n\n';
  const above = added + cut;
  eq('an edit above it does not lose it', M.homeFor(above, d).at, from + added.length);

  // the words right at the seam rewritten: the far side still finds it
  const reworded = cut.replace('had been burning for ninety-one years.', 'had burned for ninety-one years.');
  const near = M.homeFor(reworded, d);
  ok('a rewrite at the seam still finds a place', near.at !== -1);
  ok('but does not claim to be sure', !near.sure);

  // the paragraph gone altogether
  const gone = NOVEL.slice(0, NOVEL.indexOf('The lamp')) + NOVEL.slice(NOVEL.indexOf('# Two'));
  eq('a paragraph that is gone has no home', M.homeFor(gone, d).at, -1);

  // a darling cut from the very start of a document has no text before it
  const d2 = M.cutFrom('Only this.', 0, 5);
  eq('a cut at the start keeps nothing before', d2.before, '');
  eq('and still goes home', M.homeFor('this.', d2).at, 0);

  // restoring must not run two words together
  eq('a space is added where words would collide', M.restoreText('ab', 1, 'X'), ' X ');
  eq('and not where there is already space', M.restoreText('a b', 2, 'X'), 'X ');
  eq('nor at the very end', M.restoreText('a ', 2, 'X'), 'X');
}

/* ----------------------------------------------------------------- covers */

/* A cover is painted from the document's own path, so the same book has to
   get the same face every time, on every machine, with nothing stored. */
{
  const book = { path: '/Users/someone/Books/The Lighthouse Keeper.md',
                 title: 'The Lighthouse Keeper', author: 'Marta Vance' };

  eq('the same path always gives the same seed', M.seedOf(book.path), M.seedOf(book.path));
  ok('a different path gives a different one', M.seedOf(book.path) !== M.seedOf(book.path + 'x'));
  eq('and the cover is the same twice', M.coverFor(book), M.coverFor(book));
  ok('but not the same as another book\'s',
     M.coverFor(book) !== M.coverFor({ ...book, path: '/Users/someone/Books/Salt.md' }));

  const svg = M.coverFor(book);
  ok('it is an svg', svg.startsWith('<svg') && svg.endsWith('</svg>'));
  ok('the title is real text, not a picture of it', svg.includes('THE LIGHTHOUSE') || svg.includes('The Lighthouse'));
  ok('the author is on it', svg.includes('MARTA VANCE'));
  ok('and a screen reader is told what it is', svg.includes('role="img"') && svg.includes('aria-label="The Lighthouse Keeper"'));

  // markup in a title must not become markup in the cover
  const nasty = M.coverFor({ path: 'x', title: 'Tom & <script>Jerry</script>', author: '"Quoted"' });
  ok('a title cannot smuggle markup in', !nasty.includes('<script>'));
  ok('and its ampersand is escaped', nasty.includes('&amp;'));

  /* Type is only readable if its lightness is decided by the ground, so this
     checks every palette at once and names the ones that got it wrong. */
  const unreadable = [];
  for (let i = 0; i < 500; i++) {
    const p = M.paletteFor((i * 2654435761) % 4294967296);
    const light = Number(/,\s*([0-9.]+)%\)$/.exec(p.ink)[1]);
    if (p.dark ? light < 85 : light > 25) unreadable.push(`${i}: ${p.ink} on ${p.ground}`);
  }
  eq('every palette puts readable type on its own ground', unreadable, []);

  // titles break where a person would break them
  eq('one word stays one line', M.breakTitle('Salt'), ['Salt']);
  eq('two words of a long title split', M.breakTitle('The Lighthouse Keeper').length <= 3, true);
  ok('no line is empty', M.breakTitle('A Catalogue of Small Lights').every((l) => l.trim().length));
  eq('every word survives the break',
     M.breakTitle('A Catalogue of Small Lights').join(' '), 'A Catalogue of Small Lights');
  eq('an empty title breaks into nothing', M.breakTitle(''), []);

  // a long title must still fit the tile
  const long = M.typeFor({ title: 'The Extraordinarily Long And Overreaching Title Of A Debut Novel' }, 1);
  ok('a long title is set smaller', long.size < 24);
  ok('and still on few enough lines to fit', long.lines.length <= 4);
  ok('a short one is set large', M.typeFor({ title: 'Salt' }, 1).size > 24);

  // an untitled document still gets a cover
  ok('an untitled document still gets one', M.coverFor({ path: '/x/y.md' }).startsWith('<svg'));
}

/* ------------------------------------------------------------------ shelf */

/* A shelf is an arrangement over paths, not a place on disk. The rules worth
   holding down are the ones where a book could go missing. */
{
  const S = require_('../src/main/shelf.js');
  const book = (p, t) => ({ path: p, name: p, time: t });
  const a = book('/b/a.md', 300), b = book('/b/b.md', 200), c = book('/b/c.md', 100);

  // nothing arranged yet
  const fresh = S.arrange([], [a, b, c]);
  eq('with no shelves kept, there is one', fresh.length, 1);
  eq('and it is named', fresh[0].name, S.DEFAULT_SHELF);
  eq('holding every book, newest first', fresh[0].books.map((x) => x.path), ['/b/a.md', '/b/b.md', '/b/c.md']);

  // an arrangement that was kept
  const kept = [{ id: 's1', name: 'Novels', paths: ['/b/c.md', '/b/a.md'] },
                { id: 's2', name: 'Stories', paths: ['/b/b.md'] }];
  const arranged = S.arrange(kept, [a, b, c]);
  eq('a kept order is kept', arranged[0].books.map((x) => x.path), ['/b/c.md', '/b/a.md']);
  eq('across shelves', arranged[1].books.map((x) => x.path), ['/b/b.md']);

  // a document opened since last time has never been shelved
  const d = book('/b/d.md', 400);
  const withNew = S.arrange(kept, [a, b, c, d]);
  eq('a new document goes to the front of the first shelf',
     withNew[0].books.map((x) => x.path), ['/b/d.md', '/b/c.md', '/b/a.md']);

  // a file that is gone from disk
  const gone = S.arrange(kept, [a, b]);
  eq('a file that is gone leaves the shelf', gone[0].books.map((x) => x.path), ['/b/a.md']);
  eq('and no book is invented', gone.flatMap((s) => s.books).length, 2);

  // moving
  const moved = S.moveBook(kept, '/b/a.md', 's2', 0);
  eq('a book leaves the shelf it was on', moved[0].paths, ['/b/c.md']);
  eq('and lands where it was dropped', moved[1].paths, ['/b/a.md', '/b/b.md']);

  const within = S.moveBook(kept, '/b/c.md', 's1', 1);
  eq('a move inside one shelf counts positions after it has left',
     within[0].paths, ['/b/a.md', '/b/c.md']);

  const past = S.moveBook(kept, '/b/b.md', 's1', 99);
  eq('dropping past the end lands at the end', past[0].paths, ['/b/c.md', '/b/a.md', '/b/b.md']);

  // shelves themselves
  eq('a shelf can be moved', S.moveShelf(kept, 's2', 0).map((s) => s.id), ['s2', 's1']);
  eq('a shelf can be renamed', S.renameShelf(kept, 's2', 'Shorts')[1].name, 'Shorts');
  eq('an empty name is refused', S.renameShelf(kept, 's2', '   ')[1].name, 'Stories');

  const removed = S.removeShelf(kept, 's2');
  eq('removing a shelf leaves the others', removed.length, 1);
  eq('and its books are not lost with it', removed[0].paths, ['/b/c.md', '/b/a.md', '/b/b.md']);
  eq('the last shelf cannot be removed', S.removeShelf([kept[0]], 's1').length, 1);

  // front matter
  eq('a title is read from the front matter',
     S.metaFrom('Title: The Lighthouse Keeper\nAuthor: Marta Vance\n\nThe lamp...').title,
     'The Lighthouse Keeper');
  eq('and the author', S.metaFrom('Title: X\nAuthor: Marta Vance\n').author, 'Marta Vance');
  eq('a document with no front matter has none', S.metaFrom('The lamp had been burning.').title, '');
  eq('reading stops at the first line that is not front matter',
     S.metaFrom('Title: X\n\nAuthor: not really\n').author, '');
}

/* ------------------------------------------------- the first-paint palette */

/* theme.css paints before any script runs, so its :root has to hold exactly
   what themes.js derives for the default theme. These two have drifted apart
   twice, both times showing as a Material that changed colour the moment the
   picker was opened. `npm run palette` writes the stylesheet from the source
   of truth; this makes sure someone did. */
{
  const css = readFileSync(new URL('../src/renderer/css/theme.css', import.meta.url), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const inCss = {};
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) inCss[m[1]] = m[2].trim();

  const derived = paletteFor('material');
  const drifted = Object.entries(derived)
    .filter(([k, v]) => (inCss[k] || '').toLowerCase() !== String(v).toLowerCase())
    .map(([k, v]) => `${k}: css has ${inCss[k] || '(missing)'}, themes.js derives ${v}`);
  eq('the stylesheet paints the palette themes.js derives (npm run palette)', drifted, []);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => 'FAIL  ' + f).join('\n\n') + '\n');
  process.exit(1);
}
