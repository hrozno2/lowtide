/* Pure-function tests for the markup and document layers.
   node scripts/unit.mjs   (bundles the ESM sources first) */
import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const out = join(tmpdir(), `low-tide-units-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: ['scripts/unit-entry.js'],
  bundle: true, format: 'esm', outfile: out, logLevel: 'error'
});
const M = await import(out);

let pass = 0;
const failures = [];
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass++;
  else failures.push(`${name}\n    got:  ${a}\n    want: ${b}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ------------------------------------------------------------- line types */
const type = (t) => M.classifyLine(t).type;
eq('empty line', type(''), 'blank');
eq('whitespace only', type('   \t '), 'blank');
eq('heading level 1', M.classifyLine('# One').level, 1);
eq('heading level 4', M.classifyLine('#### Four').level, 4);
eq('five hashes is not a heading', type('##### Five'), 'body');
eq('hash without space is body', type('#Nope'), 'body');
eq('hash alone is body', type('#'), 'body');
eq('heading title trimmed', M.classifyLine('##   Spaced   ').title, 'Spaced');
eq('centered', type('> middle <'), 'center');
eq('right aligned', type('> later'), 'right');
eq('lone > is body', type('>'), 'body');
eq('page break equals', type('==='), 'pagebreak');
eq('page break dashes', type('---'), 'pagebreak');
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
eq('chapter starts a section', sec('# A\n\nx\n\n# B\n\ny').length, 2);
ok('first paragraph is flush', sec('# A\n\none\n\ntwo')[0].html.includes('<p class="flush">one</p>'));
ok('second paragraph indents', sec('# A\n\none\n\ntwo')[0].html.includes('<p>two</p>'));
ok('notes hidden by default', !sec('a [[note]] b')[0].html.includes('note'));
ok('notes shown when asked', sec('a [[note]] b', { notes: true })[0].html.includes('class="note"'));
ok('comments never printed', !sec('a /* secret */ b')[0].html.includes('secret'));
ok('html is escaped', sec('a < b & c')[0].html.includes('&lt;') && sec('a < b & c')[0].html.includes('&amp;'));
ok('list rendered', sec('- one')[0].html.includes('<p class="list">'));
eq('chapter tracked on the page', sec('# Ch\n\nx')[0].chapter, 'Ch');

/* ------------------------------------------------------------------ print */
const html = M.printHtml('Title: T\nAuthor: A\n\n# One\n\nbody', { title: 'T' },
  { titlePage: true, template: { pageSize: 'a4', margin: 1.25, fontSize: 11, leading: 1.5, justify: false } });
ok('print uses A4', html.includes('size: A4'));
ok('print uses margin', html.includes('margin: 1.25in'));
ok('print uses type size', html.includes('font-size: 11pt'));
ok('print uses leading', html.includes('line-height: 1.5'));
ok('ragged when not justified', html.includes('text-align: left'));
ok('title page included', html.includes('title-page') && html.includes('>T<'));
ok('front matter not in body', !html.includes('Title: T'));

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
const require_ = createRequire(import.meta.url);
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

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => 'FAIL  ' + f).join('\n\n') + '\n');
  process.exit(1);
}
