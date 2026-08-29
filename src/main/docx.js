/* A minimal .docx writer.
 *
 * A Word file is a zip of a few XML parts. Writing them directly keeps the app
 * free of a document-generation dependency, and the output is a genuine .docx
 * rather than HTML wearing a Word extension.
 */
'use strict';

/* ------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** Store-only zip: no compression, which keeps this short and is valid. */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method: stored
    local.writeUInt16LE(0, 10);          // time
    local.writeUInt16LE(0x21, 12);       // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ------------------------------------------------------------------- xml */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function runXml(run) {
  const props = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.underline) props.push('<w:u w:val="single"/>');
  if (run.strike) props.push('<w:strike/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paragraphXml(block, opts) {
  if (block.type === 'pagebreak') {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  const props = [];
  const style = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3' }[block.type];
  if (style) props.push(`<w:pStyle w:val="${style}"/>`);

  if (block.type === 'center' || style) props.push('<w:jc w:val="center"/>');
  else if (block.type === 'right') props.push('<w:jc w:val="right"/>');
  else if (opts.justify) props.push('<w:jc w:val="both"/>');

  if (block.type === 'p' && block.indent) props.push('<w:ind w:firstLine="720"/>');
  if (block.type === 'list') props.push('<w:ind w:left="720" w:hanging="360"/>');

  // Word measures line spacing in 240ths of a line.
  const spacing = Math.round((opts.leading || 1.8) * 240);
  props.push(`<w:spacing w:line="${spacing}" w:lineRule="auto" w:after="0"/>`);

  const runs = (block.runs || []).map(runXml).join('') || '<w:r><w:t/></w:r>';
  return `<w:p><w:pPr>${props.join('')}</w:pPr>${runs}</w:p>`;
}

function stylesXml(opts) {
  const size = Math.round((opts.fontSize || 12) * 2);   // half-points
  const font = 'Georgia';
  const heading = (id, name, sz) => `
    <w:style w:type="paragraph" w:styleId="${id}">
      <w:name w:val="${name}"/><w:basedOn w:val="Normal"/>
      <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="240"/><w:jc w:val="center"/></w:pPr>
      <w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr>
    </w:style>`;

  return `${XML}<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${size}"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  ${heading('Heading1', 'heading 1', size + 6)}
  ${heading('Heading2', 'heading 2', size + 3)}
  ${heading('Heading3', 'heading 3', size + 1)}
</w:styles>`;
}

/**
 * @param blocks [{ type, runs:[{text,bold,italic,underline,strike}], indent }]
 * @param meta   { title, author }
 * @param opts   { fontSize, leading, justify, margin, titlePage }
 */
function buildDocx(blocks, meta = {}, opts = {}) {
  const margin = Math.round((opts.margin || 1) * 1440);   // twips
  const body = [];

  if (opts.titlePage && (meta.title || meta.author)) {
    body.push('<w:p><w:pPr><w:spacing w:before="4000"/><w:jc w:val="center"/></w:pPr></w:p>');
    if (meta.title) {
      body.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${esc(meta.title)}</w:t></w:r></w:p>`);
    }
    if (meta.author) {
      body.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>by</w:t></w:r></w:p>');
      body.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${esc(meta.author)}</w:t></w:r></w:p>`);
    }
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }

  for (const block of blocks) body.push(paragraphXml(block, opts));

  const document = `${XML}<w:document xmlns:w="${W}"><w:body>
${body.join('\n')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}"/>
</w:sectPr></w:body></w:document>`;

  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml(opts), 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
  ]);
}

module.exports = { buildDocx };
