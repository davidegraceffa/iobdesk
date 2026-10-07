/**
 * Genera i CV DOCX di esempio usati dai test (nessun dato reale).
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api node tests/fixtures/cv/build.js
 *
 * - cv-one-column-en.docx: CV inglese a una colonna
 * - cv-two-columns-it.docx: CV italiano a due colonne (tabella di layout con barra laterale colorata)
 *
 * I documenti contengono apposta i casi che il parser deve gestire: run spezzati con lo stesso stile,
 * paragrafi con stili misti, elenchi puntati veri, tabulazioni, link, celle di tabella con sfondo.
 */
const path = require('node:path');
const fs = require('node:fs');
const JSZip = require(require.resolve('jszip', { paths: [path.join(__dirname, '../../../apps/api')] }));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (text) => `<w:t xml:space="preserve">${esc(text)}</w:t>`;
/** run: testo con proprietà opzionali (b = grassetto, color, lang) */
const r = (text, { b, i, color, lang, rsid } = {}) => {
  const props = [b ? '<w:b/>' : '', i ? '<w:i/>' : '', color ? `<w:color w:val="${color}"/>` : '', lang ? `<w:lang w:val="${lang}"/>` : ''].join('');
  return `<w:r${rsid ? ` w:rsidRPr="${rsid}"` : ''}>${props ? `<w:rPr>${props}</w:rPr>` : ''}${t(text)}</w:r>`;
};
const tab = () => '<w:r><w:tab/></w:r>';
const p = (runs, { style, bullet, tabs } = {}) => {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    tabs ? '<w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs>' : '',
  ].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${Array.isArray(runs) ? runs.join('') : r(runs)}</w:p>`;
};
const bullet = (runs) => p(runs, { style: 'ListParagraph', bullet: true });
const h1 = (text) => p(text, { style: 'Heading1' });

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
const documentXml = (body) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${SECT}</w:body></w:document>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif" w:cs="Liberation Serif"/><w:sz w:val="21"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="60"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Liberation Sans"/><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="48"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9891A"/></w:pBdr><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Liberation Sans"/><w:b/><w:caps/><w:color w:val="C9891A"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="454" w:hanging="284"/><w:contextualSpacing/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Sidebar"><w:name w:val="Sidebar"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Liberation Sans"/><w:color w:val="FFFFFF"/><w:sz w:val="19"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="SidebarHeading"><w:name w:val="Sidebar Heading"/><w:basedOn w:val="Sidebar"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="F2C14E"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="F2C14E"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}>
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="454" w:hanging="284"/></w:pPr><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/></w:rPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/giulia" TargetMode="External"/>
</Relationships>`;

async function write(name, body) {
  const zip = new JSZip();
  // data fissa: il file generato è identico a ogni esecuzione
  const date = new Date('2026-01-01T00:00:00Z');
  const add = (file, content) => zip.file(file, content, { date });
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', RELS);
  add('word/document.xml', documentXml(body));
  add('word/styles.xml', STYLES);
  add('word/numbering.xml', NUMBERING);
  add('word/_rels/document.xml.rels', DOC_RELS);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(__dirname, name), buffer);
  console.log(`${name}: ${buffer.length} byte`);
}

// ── CV a una colonna (inglese) ────────────────────────────────────────────────────
const ONE_COLUMN = [
  p('Alex Example', { style: 'Title' }),
  p('Full-Stack Developer · alex@example.com · +00 000 000 000 · Remote'),
  h1('Summary'),
  // stesso stile ma run spezzati (rsid e lingua diversi), come fa Word dopo qualche modifica
  p([
    r('Full-stack developer with 6 years of experience building web applications ', { rsid: '00A1B2C3' }),
    r('with TypeScript, Node.js and React. ', { lang: 'en-GB' }),
    r('I care about clean APIs, automated tests and reliable delivery.'),
  ]),
  h1('Skills'),
  p('Languages: TypeScript, JavaScript, SQL'),
  p('Backend: Node.js, NestJS, PostgreSQL, Redis'),
  p('Frontend: React, Next.js, Tailwind CSS'),
  p('Cloud and tooling: AWS, Docker, GitHub Actions, Jest'),
  h1('Experience'),
  p([r('Senior Developer — Northwind Labs', { b: true }), tab(), r('2021 – 2025', { i: true })], { tabs: true }),
  bullet('Built REST APIs with NestJS and PostgreSQL used by 40 internal teams.'),
  bullet('Led the migration of a React frontend to Next.js, cutting load time by 35%.'),
  bullet('Introduced CI/CD pipelines with GitHub Actions and Docker.'),
  p([r('Developer — Contoso Web', { b: true }), tab(), r('2019 – 2021', { i: true })], { tabs: true }),
  bullet('Developed React components and Node.js services for an e-commerce platform.'),
  // stili misti nello stesso paragrafo: il testo non si può sostituire in sicurezza
  bullet([r('Mentored '), r('2 junior developers', { b: true }), r(' on testing with Jest.')]),
  h1('Education'),
  p('BSc Computer Science — Example University, 2018'),
  h1('Languages'),
  p('English (fluent), Italian (native)'),
].join('');

// ── CV a due colonne (italiano): tabella di layout con barra laterale ─────────────
const side = (text) => p([`<w:r>${t(text)}</w:r>`], { style: 'Sidebar' });
const sideH = (text) => p(text, { style: 'SidebarHeading' });
const cell = (width, content, shade) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:tcMar><w:top w:w="170" w:type="dxa"/><w:left w:w="200" w:type="dxa"/><w:bottom w:w="170" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`;

const LEFT = [
  sideH('Contatti'),
  side('giulia@example.com'),
  side('+00 000 000 000'),
  // paragrafo con link: non modificabile
  `<w:p><w:pPr><w:pStyle w:val="Sidebar"/></w:pPr><w:hyperlink r:id="rId3"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>${t('example.com/giulia')}</w:r></w:hyperlink></w:p>`,
  sideH('Competenze'),
  side('TypeScript, JavaScript, SQL'),
  side('Node.js, NestJS, Express'),
  side('React, Vue, Tailwind CSS'),
  side('PostgreSQL, MongoDB, Redis'),
  side('Docker, AWS, CI/CD'),
  sideH('Lingue'),
  side('Italiano (madrelingua)'),
  side('Inglese (C1)'),
].join('');

const RIGHT = [
  p('Giulia Esempio', { style: 'Title' }),
  p('Sviluppatrice full-stack'),
  h1('Profilo'),
  p('Sviluppatrice full-stack con 8 anni di esperienza nella realizzazione di applicazioni web con TypeScript, Node.js e React. Attenta alla qualità del codice, ai test automatici e alla collaborazione con il team di prodotto.'),
  h1('Esperienze professionali'),
  p([r('Sviluppatrice senior — Aurora Software S.r.l.', { b: true }), tab(), r('2020 – oggi', { i: true })], { tabs: true }),
  bullet('Progettato e sviluppato API REST con NestJS e PostgreSQL per una piattaforma con 120 clienti aziendali.'),
  bullet('Guidato la riscrittura del frontend in React con TypeScript, riducendo i tempi di caricamento del 30%.'),
  bullet('Automatizzato rilasci e test con Docker e pipeline CI/CD.'),
  p([r('Sviluppatrice — Bottega Digitale', { b: true }), tab(), r('2017 – 2020', { i: true })], { tabs: true }),
  bullet('Sviluppato servizi Node.js con Express e MongoDB per applicazioni di e-commerce.'),
  bullet('Realizzato interfacce in Vue e integrato sistemi di pagamento.'),
  h1('Formazione'),
  p('Laurea in Informatica — Università di Esempio, 2016'),
].join('');

const TWO_COLUMNS = `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6638"/></w:tblGrid><w:tr>${cell(3000, LEFT, '1F3A5F')}${cell(6638, RIGHT)}</w:tr></w:tbl><w:p/>`;

(async () => {
  await write('cv-one-column-en.docx', ONE_COLUMN);
  await write('cv-two-columns-it.docx', TWO_COLUMNS);
})();
