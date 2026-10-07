import type { CvStructure } from '@jobagg/shared';
import JSZip from 'jszip';

export interface CoverLetterDocInput {
  candidateName: string;
  /** riga dei contatti sotto il nome (email, telefono, link) */
  contacts: string;
  /** data già formattata nella lingua della lettera */
  date: string;
  company: string;
  subject: string;
  /** dal saluto alla firma: paragrafi separati da una riga vuota */
  body: string;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const FONT = 'Calibri';

function escapeXml(text: string): string {
  // i caratteri di controllo (a parte tabulazione e a capo) non sono ammessi in XML 1.0
  return [...text]
    .filter((ch) => ch >= ' ' || ch === '\t' || ch === '\n' || ch === '\r')
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface ParagraphStyle {
  /** mezzi punti */
  size?: number;
  bold?: boolean;
  color?: string;
  /** spazio dopo il paragrafo, in ventesimi di punto */
  after?: number;
}

/** Un paragrafo; gli a capo semplici nel testo diventano interruzioni di riga. */
function paragraph(text: string, style: ParagraphStyle = {}): string {
  const rPr = [
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>`,
    style.bold ? '<w:b/>' : '',
    style.color ? `<w:color w:val="${style.color}"/>` : '',
    `<w:sz w:val="${style.size ?? 22}"/><w:szCs w:val="${style.size ?? 22}"/>`,
  ].join('');
  const runs = text
    .split('\n')
    .map((line, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join('');
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${style.after ?? 200}" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${rPr}</w:rPr>${runs}</w:r></w:p>`;
}

/** Paragrafi del testo della lettera: separati da righe vuote, senza spazi superflui. */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Recapiti presi dalla parte iniziale del CV base (email, telefono, link), da mettere
 * nell'intestazione della lettera. Restano in locale: all'LLM non vengono mai inviati.
 */
export function contactLine(structure: CvStructure): string {
  const personal = structure.sections.find((s) => s.type === 'personal');
  if (!personal) return '';
  const pieces = personal.paragraphIds
    .map((id) => structure.paragraphs.find((p) => p.id === id)?.text ?? '')
    .flatMap((text) => text.split(/[\n\t|·•]/))
    .map((piece) => piece.trim())
    .filter(
      (piece) =>
        piece.length <= 80 &&
        (/\S+@\S+\.\S+/.test(piece) ||
          /(?:https?:\/\/|www\.|linkedin\.com|github\.com)/i.test(piece) ||
          /^[^\p{L}]*\+?\d[\d\s()./-]{6,}$/u.test(piece.replace(/^[\p{L}.]+\s*:\s*/u, ''))),
    );
  return [...new Set(pieces)].slice(0, 4).join(' · ');
}

/**
 * DOCX della lettera di candidatura: un documento semplice e sobrio (A4, margini di 2,5 cm)
 * con intestazione, data, destinatario, oggetto e testo. Non dipende dal layout del CV base.
 */
export async function buildCoverLetterDocx(input: CoverLetterDocInput): Promise<Buffer> {
  const parts: string[] = [];
  if (input.candidateName) {
    parts.push(paragraph(input.candidateName, { size: 30, bold: true, after: input.contacts ? 40 : 360 }));
  }
  if (input.contacts) parts.push(paragraph(input.contacts, { size: 18, color: '555555', after: 360 }));
  parts.push(paragraph(input.date, { after: 240 }));
  if (input.company) parts.push(paragraph(input.company, { after: 240 }));
  if (input.subject.trim()) parts.push(paragraph(input.subject.trim(), { bold: true, after: 280 }));
  for (const text of splitParagraphs(input.body)) parts.push(paragraph(text));

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', document);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
