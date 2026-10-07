import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { RawParagraph } from './structure';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_XML = 'word/document.xml';
const MAX_DOCUMENT_XML_BYTES = 30 * 1024 * 1024;

/** Proprietà di run che non cambiano l'aspetto: ignorate nel confronto tra run. */
const NEUTRAL_RUN_PROPS = new Set(['lang', 'noProof', 'proofErr', 'rtl', 'bidi']);
/** Elementi che rendono rischioso sostituire il testo di un paragrafo. */
const BLOCKING: Record<string, string> = {
  hyperlink: 'contiene un link',
  fldSimple: 'contiene un campo',
  fldChar: 'contiene un campo',
  drawing: 'contiene un’immagine o una casella di testo',
  pict: 'contiene un’immagine',
  object: 'contiene un oggetto incorporato',
  AlternateContent: 'contiene un’immagine o una casella di testo',
  ins: 'contiene revisioni',
  del: 'contiene revisioni',
  sdt: 'contiene un controllo contenuto',
  footnoteReference: 'contiene una nota',
  endnoteReference: 'contiene una nota',
  commentReference: 'contiene un commento',
  smartTag: 'contiene tag avanzati',
  customXml: 'contiene tag avanzati',
};
/** Contenitori in cui non scendere quando si legge il testo proprio di un paragrafo. */
const NESTED_CONTAINERS = new Set(['drawing', 'pict', 'object', 'AlternateContent', 'txbxContent']);
const BULLET_CHARS = /^\s*[•▪■●◦‣·–\-*]\s+/;

export class DocxEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxEditError';
  }
}

export class InvalidDocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocxError';
  }
}

const isElement = (node: Node | null | undefined): node is Element => !!node && node.nodeType === 1;
const isW = (node: Node | null | undefined, name: string): node is Element =>
  isElement(node) && node.namespaceURI === W && node.localName === name;

function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n);
  return out;
}

function child(el: Element, name: string): Element | undefined {
  return children(el).find((c) => isW(c, name));
}

function hasAncestor(node: Node, localName: string, stopAt?: Node): boolean {
  for (let n = node.parentNode; n && n !== stopAt; n = n.parentNode) {
    if (isElement(n) && n.localName === localName) return true;
  }
  return false;
}

/**
 * Documento DOCX modificabile "in place": si interviene direttamente su `word/document.xml`
 * (JSZip + parser XML che preserva l'ordine), cambiando solo il testo dei paragrafi.
 * Proprietà di paragrafo e di carattere (`w:pPr`, `w:rPr`), tabelle di layout, immagini,
 * stili, intestazioni e piè di pagina non vengono mai toccati né rigenerati.
 */
export class DocxDocument {
  /** id stabile → elemento w:p. Gli id sono la posizione nel documento originale: p0, p1, … */
  private readonly byId = new Map<string, Element>();
  private insertCounter = 0;

  private constructor(
    private readonly zip: JSZip,
    private readonly doc: Document,
  ) {
    this.index();
  }

  static async load(buffer: Buffer): Promise<DocxDocument> {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new InvalidDocxError('Il file non è un documento DOCX (archivio ZIP non valido)');
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new InvalidDocxError('Il file non è un documento DOCX leggibile');
    }
    const entry = zip.file(DOCUMENT_XML);
    if (!entry || !zip.file('[Content_Types].xml')) {
      throw new InvalidDocxError('Il file non è un documento Word (.docx): manca word/document.xml');
    }
    const xml = await entry.async('string');
    if (xml.length > MAX_DOCUMENT_XML_BYTES) throw new InvalidDocxError('Documento troppo grande');
    let doc: Document;
    try {
      doc = new DOMParser({
        onError: (level, message) => {
          if (level !== 'warning') throw new Error(message);
        },
      }).parseFromString(xml, 'text/xml');
    } catch (err) {
      throw new InvalidDocxError(`word/document.xml non è XML valido: ${(err as Error).message}`);
    }
    if (!doc.documentElement || doc.getElementsByTagNameNS(W, 'body').length === 0) {
      throw new InvalidDocxError('Documento Word senza corpo del testo');
    }
    return new DocxDocument(zip, doc);
  }

  private allParagraphs(): Element[] {
    const list = this.doc.getElementsByTagNameNS(W, 'p');
    const out: Element[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list.item(i) as Element;
      // mc:Fallback contiene la copia VML delle caselle di testo: non va contata due volte
      if (!hasAncestor(p, 'Fallback')) out.push(p);
    }
    return out;
  }

  private index(): void {
    this.allParagraphs().forEach((p, i) => this.byId.set(`p${i}`, p));
  }

  // ── lettura ───────────────────────────────────────────────────────────────────

  /** Run di testo "propri" del paragrafo (figli diretti w:r con testo, tabulazioni o a capo). */
  private textRuns(p: Element): Element[] {
    return children(p).filter(
      (c) => isW(c, 'r') && children(c).some((x) => isW(x, 't') || isW(x, 'tab') || this.isLineBreak(x)),
    );
  }

  /** A capo semplice: le interruzioni di pagina/colonna (w:br con w:type) sono impaginazione e non si toccano. */
  private isLineBreak(el: Element): boolean {
    if (el.namespaceURI !== W) return false;
    return el.localName === 'cr' || (el.localName === 'br' && !el.getAttribute('w:type'));
  }

  private runText(run: Element): string {
    let text = '';
    for (const c of children(run)) {
      if (isW(c, 't')) text += c.textContent ?? '';
      else if (isW(c, 'tab')) text += '\t';
      else if (this.isLineBreak(c)) text += '\n';
    }
    return text;
  }

  /** Testo del paragrafo, esclusi i paragrafi annidati (caselle di testo ancorate al suo interno). */
  private paragraphText(p: Element): string {
    let text = '';
    const walk = (node: Node) => {
      for (let n = node.firstChild; n; n = n.nextSibling) {
        if (!isElement(n)) continue;
        if (NESTED_CONTAINERS.has(n.localName ?? '')) continue;
        if (isW(n, 't')) text += n.textContent ?? '';
        else if (isW(n, 'tab')) text += '\t';
        else if (this.isLineBreak(n)) text += '\n';
        else if (isW(n, 'pPr') || isW(n, 'rPr')) continue;
        else walk(n);
      }
    };
    walk(p);
    return text;
  }

  private styleOf(p: Element): string | undefined {
    const pPr = child(p, 'pPr');
    const style = pPr && child(pPr, 'pStyle');
    return style?.getAttributeNS(W, 'val') ?? style?.getAttribute('w:val') ?? undefined;
  }

  private isBullet(p: Element, text: string): boolean {
    const pPr = child(p, 'pPr');
    if (pPr && child(pPr, 'numPr')) return true;
    const style = this.styleOf(p) ?? '';
    return /list|bullet|elenco|aufz/i.test(style) || BULLET_CHARS.test(text);
  }

  /** Firma dello stile di un run, senza le proprietà che non incidono sull'aspetto. */
  private runSignature(run: Element): string {
    const rPr = child(run, 'rPr');
    if (!rPr) return '';
    const serializer = new XMLSerializer();
    return children(rPr)
      .filter((c) => !NEUTRAL_RUN_PROPS.has(c.localName ?? ''))
      .map((c) => serializer.serializeToString(c).replace(/\sxmlns(:\w+)?="[^"]*"/g, ''))
      .sort()
      .join('|');
  }

  /** Motivo per cui il testo del paragrafo non si può sostituire in sicurezza, oppure `null`. */
  private notEditableReason(p: Element): string | null {
    const walk = (node: Node): string | null => {
      for (let n = node.firstChild; n; n = n.nextSibling) {
        if (!isElement(n)) continue;
        const reason = BLOCKING[n.localName ?? ''];
        if (reason) return reason;
        const nested = walk(n);
        if (nested) return nested;
      }
      return null;
    };
    const blocking = walk(p);
    if (blocking) return blocking;
    // run di soli spazi non contano: spesso Word li separa con stili diversi senza effetto visibile
    const runs = this.textRuns(p).filter((r) => this.runText(r).trim() !== '');
    if (runs.length === 0) return 'paragrafo senza testo modificabile';
    const signatures = new Set(runs.map((r) => this.runSignature(r)));
    if (signatures.size > 1) return 'usa più stili di carattere nello stesso paragrafo';
    return null;
  }

  /** Paragrafi con testo, in ordine di documento, con id stabili. */
  extractParagraphs(): RawParagraph[] {
    const out: RawParagraph[] = [];
    for (const [id, p] of this.byId) {
      const text = this.paragraphText(p).replace(/\u00a0/g, ' ');
      if (!text.trim()) continue;
      const reason = this.notEditableReason(p);
      const style = this.styleOf(p);
      const pPr = child(p, 'pPr');
      out.push({
        id,
        text: text.trim(),
        style,
        isBullet: this.isBullet(p, text),
        editable: reason === null,
        notEditableReason: reason ?? undefined,
        headingStyle:
          /^(?:heading|titolo|berschrift|überschrift|titre|ttulo|título|kop)\s?\d/i.test(style ?? '') ||
          !!(pPr && child(pPr, 'outlineLvl')),
        inTextBox: hasAncestor(p, 'txbxContent'),
      });
    }
    return out;
  }

  getText(id: string): string {
    return this.paragraphText(this.require(id)).trim();
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Testo completo del documento (per i controlli finali). */
  fullText(): string {
    return this.allParagraphs()
      .map((p) => this.paragraphText(p).trim())
      .filter(Boolean)
      .join('\n');
  }

  // ── modifica ──────────────────────────────────────────────────────────────────

  private require(id: string): Element {
    const p = this.byId.get(id);
    if (!p || !p.parentNode) throw new DocxEditError(`Paragrafo ${id} inesistente o già rimosso`);
    return p;
  }

  private setParagraphText(p: Element, text: string): void {
    const reason = this.notEditableReason(p);
    if (reason) throw new DocxEditError(`Paragrafo non modificabile: ${reason}`);
    const runs = this.textRuns(p);
    const target = runs.find((r) => this.runText(r).trim() !== '') ?? runs[0];
    if (!target) throw new DocxEditError('Paragrafo senza run di testo');

    // il marcatore del bullet scritto a mano ("• ") resta com'è: fa parte dell'aspetto, non del contenuto
    const marker = BULLET_CHARS.exec(this.paragraphText(p))?.[0] ?? '';
    const content = marker && !BULLET_CHARS.test(text) ? `${marker}${text}` : text;

    for (const c of children(target)) if (!isW(c, 'rPr')) target.removeChild(c);
    const prefix = target.prefix ? `${target.prefix}:` : 'w:';
    for (const part of content.split(/(\t|\n)/)) {
      if (part === '') continue;
      if (part === '\t') target.appendChild(this.doc.createElementNS(W, `${prefix}tab`));
      else if (part === '\n') target.appendChild(this.doc.createElementNS(W, `${prefix}br`));
      else {
        const t = this.doc.createElementNS(W, `${prefix}t`);
        t.setAttribute('xml:space', 'preserve');
        t.appendChild(this.doc.createTextNode(part));
        target.appendChild(t);
      }
    }
    // gli altri run di testo hanno lo stesso stile (verificato sopra): si svuotano
    for (const run of runs) if (run !== target) p.removeChild(run);
  }

  /** Paragrafo corrispondente nella copia di ripiego (VML) di una casella di testo, se esiste. */
  private fallbackTwin(p: Element): Element | null {
    let alternate: Element | null = null;
    for (let n = p.parentNode; n; n = n.parentNode) {
      if (isElement(n) && n.localName === 'AlternateContent') {
        alternate = n;
        break;
      }
    }
    if (!alternate) return null;
    const all = alternate.getElementsByTagNameNS(W, 'p');
    const choice: Element[] = [];
    const fallback: Element[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all.item(i) as Element;
      (hasAncestor(el, 'Fallback', alternate) ? fallback : choice).push(el);
    }
    const index = choice.indexOf(p);
    return index >= 0 && choice.length === fallback.length ? (fallback[index] ?? null) : null;
  }

  replaceText(id: string, newText: string): void {
    const p = this.require(id);
    const twin = this.fallbackTwin(p);
    this.setParagraphText(p, newText);
    if (twin) {
      try {
        this.setParagraphText(twin, newText);
      } catch {
        // la copia di ripiego resta com'è: i programmi moderni usano la versione principale
      }
    }
  }

  private assertStructural(p: Element, what: string): void {
    if (hasAncestor(p, 'txbxContent')) {
      throw new DocxEditError(`${what} non supportata nelle caselle di testo (solo sostituzione del testo)`);
    }
  }

  remove(id: string): void {
    const p = this.require(id);
    this.assertStructural(p, 'Rimozione');
    const parent = p.parentNode as Element;
    // una cella di tabella deve contenere almeno un paragrafo
    if (isW(parent, 'tc') && children(parent).filter((c) => isW(c, 'p')).length <= 1) {
      throw new DocxEditError('È l’unico paragrafo della cella: non si può rimuovere');
    }
    parent.removeChild(p);
  }

  /** Clona un paragrafo esistente dello stesso tipo (stile incluso) e lo inserisce dopo `afterId`. */
  insertAfter(afterId: string, cloneStyleFromId: string, newText: string): string {
    const after = this.require(afterId);
    const template = this.require(cloneStyleFromId);
    this.assertStructural(after, 'Inserimento');
    const reason = this.notEditableReason(template);
    if (reason) throw new DocxEditError(`Paragrafo modello non clonabile: ${reason}`);
    const clone = template.cloneNode(true) as Element;
    // gli identificativi di paragrafo di Word devono restare univoci
    for (const attr of ['w14:paraId', 'w14:textId']) if (clone.hasAttribute(attr)) clone.removeAttribute(attr);
    after.parentNode!.insertBefore(clone, after.nextSibling);
    this.setParagraphText(clone, newText);
    const id = `n${this.insertCounter++}`;
    this.byId.set(id, clone);
    return id;
  }

  /** Riordina paragrafi fratelli: i paragrafi indicati occupano, nel nuovo ordine, le stesse posizioni di prima. */
  reorder(ids: string[]): void {
    if (new Set(ids).size !== ids.length) throw new DocxEditError('Elenco di riordino con paragrafi ripetuti');
    const nodes = ids.map((id) => this.require(id));
    const parent = nodes[0]?.parentNode;
    if (!parent || nodes.some((n) => n.parentNode !== parent)) {
      throw new DocxEditError('I paragrafi da riordinare non sono nello stesso blocco del documento');
    }
    nodes.forEach((n) => this.assertStructural(n, 'Riordino'));
    const inDocOrder = children(parent as Element).filter((c) => nodes.includes(c));
    const markers = inDocOrder.map((node) => {
      const marker = this.doc.createComment('slot');
      parent.insertBefore(marker, node);
      return marker;
    });
    nodes.forEach((n) => parent.removeChild(n));
    markers.forEach((marker, i) => {
      parent.insertBefore(nodes[i]!, marker);
      parent.removeChild(marker);
    });
  }

  async toBuffer(): Promise<Buffer> {
    const xml = new XMLSerializer().serializeToString(this.doc);
    this.zip.file(DOCUMENT_XML, xml);
    return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /** XML di un paragrafo, per i test sulla preservazione di w:pPr e w:rPr. */
  paragraphXml(id: string): string {
    return new XMLSerializer().serializeToString(this.require(id));
  }
}
