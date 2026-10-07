import {
  canonicalTech,
  findTechInText,
  type AppliedCvEdit,
  type CvEdit,
  type CvParagraph,
  type CvStructure,
  type RejectedCvEdit,
} from '@jobagg/shared';
import { isMutableSection } from './docx/structure';

export interface ValidationContext {
  structure: CvStructure;
  /** competenze ed esperienze aggiuntive dichiarate dall'utente nel Profilo */
  extraSkills: string[];
  /** lingua del CV (ISO 639-1) */
  language: string;
}

export interface ValidationResult {
  accepted: AppliedCvEdit[];
  rejected: RejectedCvEdit[];
}

const lower = (s: string) => s.toLowerCase();

/** Tecnologie che il candidato possiede davvero: quelle nel CV base più le competenze aggiuntive. */
export function allowedTechnologies(structure: CvStructure, extraSkills: string[]): Set<string> {
  const allowed = new Set<string>();
  const cvText = structure.paragraphs.map((p) => p.text).join('\n');
  for (const tech of findTechInText(cvText)) allowed.add(tech);
  for (const skill of extraSkills) {
    const direct = canonicalTech(skill);
    if (direct) allowed.add(direct.name);
    for (const tech of findTechInText(skill)) allowed.add(tech);
  }
  return allowed;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\d+#]+/gu) ?? [];
}

/** Numeri "liberi" nel testo (non quelli attaccati a una sigla come S3 o ES6). */
function numbers(text: string): string[] {
  return (text.match(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)?/gu) ?? []).map((n) => n.replace(',', '.'));
}

/**
 * Nomi propri e sigle a metà frase che non compaiono da nessuna parte nel CV o nelle competenze
 * aggiuntive: segnale di un'azienda, una certificazione o uno strumento inventati.
 * In tedesco tutti i sostantivi sono maiuscoli: il controllo non è applicabile.
 */
function unknownProperNouns(newText: string, vocabulary: Set<string>, language: string): string[] {
  if (language === 'de') return [];
  const unknown: string[] = [];
  const re = /(?<=[\p{L}\d,;)]\s+|\()([\p{Lu}][\p{L}\d+#]*(?:[-/.][\p{L}\d+#]+)*)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(newText)) !== null) {
    const token = m[1] as string;
    if (token.length < 3) continue;
    const parts = words(token);
    if (parts.some((part) => part.length >= 3 && !vocabulary.has(part))) unknown.push(token);
  }
  return [...new Set(unknown)];
}

interface ContentCheck {
  newText: string;
  sourceText: string;
}

/**
 * Controllo anti-invenzione su `replace` e `insert_after`: valida fonti, tecnologie, numeri e nomi
 * propri. Le modifiche che non lo superano vengono scartate con un motivo leggibile, mai applicate.
 */
export function validateEdits(edits: CvEdit[], ctx: ValidationContext): ValidationResult {
  const { structure } = ctx;
  const byId = new Map(structure.paragraphs.map((p) => [p.id, p]));
  const sectionType = new Map(structure.sections.map((s) => [s.id, s.type]));
  const extraLower = new Set(ctx.extraSkills.map(lower));
  const allowedTech = allowedTechnologies(structure, ctx.extraSkills);
  const vocabulary = new Set([
    ...words(structure.paragraphs.map((p) => p.text).join(' ')),
    ...words(ctx.extraSkills.join(' ')),
  ]);

  const accepted: AppliedCvEdit[] = [];
  const rejected: RejectedCvEdit[] = [];
  const replaced = new Set<string>();
  const removed = new Set<string>();
  let counter = 0;

  const textTarget = (id: string, label = 'Paragrafo'): CvParagraph | string => {
    const p = byId.get(id);
    if (!p) return `${label} ${id} inesistente nel CV base`;
    if (p.isHeading) return `${label} ${id} è un’intestazione di sezione`;
    if (!p.mutable)
      return `${label} ${id} non è modificabile (dati personali, date, aziende, titoli di studio restano invariati)`;
    return p;
  };

  const sourcesOf = (edit: { sourceParagraphIds: string[]; extraSkills?: string[] }): string | { text: string } => {
    const ids = edit.sourceParagraphIds ?? [];
    const skills = edit.extraSkills ?? [];
    if (ids.length === 0 && skills.length === 0)
      return 'Modifica senza fonte: non cita né paragrafi del CV né competenze aggiuntive';
    const missing = ids.find((id) => !byId.has(id));
    if (missing) return `Fonte inesistente: paragrafo ${missing}`;
    const unknownSkill = skills.find((s) => !extraLower.has(lower(s)));
    if (unknownSkill) return `"${unknownSkill}" non è tra le competenze aggiuntive del Profilo`;
    return { text: [...ids.map((id) => byId.get(id)!.text), ...skills].join('\n') };
  };

  const checkContent = ({ newText, sourceText }: ContentCheck): string | null => {
    const inventedTech = findTechInText(newText).filter((t) => !allowedTech.has(t));
    if (inventedTech.length > 0) return `Tecnologia non presente nel CV: ${inventedTech.join(', ')}`;
    const sourceNumbers = new Set(numbers(sourceText));
    const inventedNumbers = numbers(newText).filter((n) => !sourceNumbers.has(n));
    if (inventedNumbers.length > 0)
      return `Dato numerico non presente nelle fonti citate: ${inventedNumbers.join(', ')}`;
    const nouns = unknownProperNouns(newText, vocabulary, ctx.language);
    if (nouns.length > 0) return `Termine non presente nel CV: ${nouns.join(', ')}`;
    return null;
  };

  for (const edit of edits) {
    const reject = (reason: string) => rejected.push({ edit, reason });
    const accept = () => accepted.push({ ...edit, id: `e${++counter}`, status: 'accepted' });

    if (edit.op === 'replace') {
      const target = textTarget(edit.paragraphId);
      if (typeof target === 'string') { reject(target); continue; } // prettier-ignore
      if (!target.editable) { reject(`Paragrafo ${target.id} non modificabile: ${target.notEditableReason ?? 'formattazione complessa'}`); continue; } // prettier-ignore
      if (replaced.has(target.id) || removed.has(target.id)) { reject(`Paragrafo ${target.id} già modificato da un’altra modifica`); continue; } // prettier-ignore
      const sources = sourcesOf(edit);
      if (typeof sources === 'string') { reject(sources); continue; } // prettier-ignore
      const problem = checkContent({ newText: edit.newText, sourceText: `${target.text}\n${sources.text}` });
      if (problem) { reject(problem); continue; } // prettier-ignore
      if (edit.newText.trim() === target.text.trim()) continue; // nessun cambiamento reale
      replaced.add(target.id);
      accept();
    } else if (edit.op === 'insert_after') {
      const after = byId.get(edit.afterParagraphId);
      if (!after) { reject(`Paragrafo ${edit.afterParagraphId} inesistente nel CV base`); continue; } // prettier-ignore
      if (!isMutableSection(sectionType.get(after.sectionId) ?? 'other')) { reject('Si possono aggiungere paragrafi solo a sommario, competenze ed esperienze'); continue; } // prettier-ignore
      const template = textTarget(edit.cloneStyleFrom, 'Paragrafo modello');
      if (typeof template === 'string') { reject(template); continue; } // prettier-ignore
      if (!template.editable) { reject(`Paragrafo modello ${template.id} non clonabile: ${template.notEditableReason ?? 'formattazione complessa'}`); continue; } // prettier-ignore
      const sources = sourcesOf(edit);
      if (typeof sources === 'string') { reject(sources); continue; } // prettier-ignore
      const problem = checkContent({ newText: edit.newText, sourceText: sources.text });
      if (problem) { reject(problem); continue; } // prettier-ignore
      accept();
    } else if (edit.op === 'remove') {
      const target = textTarget(edit.paragraphId);
      if (typeof target === 'string') { reject(target); continue; } // prettier-ignore
      if (replaced.has(target.id) || removed.has(target.id)) { reject(`Paragrafo ${target.id} già modificato da un’altra modifica`); continue; } // prettier-ignore
      removed.add(target.id);
      accept();
    } else {
      const section = structure.sections.find((s) => s.id === edit.sectionId);
      if (!section) { reject(`Sezione ${edit.sectionId} inesistente`); continue; } // prettier-ignore
      const ids = edit.paragraphIds;
      if (ids.length < 2 || new Set(ids).size !== ids.length) { reject('Riordino non valido: servono almeno due paragrafi distinti'); continue; } // prettier-ignore
      const outside = ids.find((id) => !section.paragraphIds.includes(id));
      if (outside) { reject(`Paragrafo ${outside} non appartiene alla sezione ${section.id}`); continue; } // prettier-ignore
      const blocked = ids.map((id) => textTarget(id)).find((t) => typeof t === 'string');
      if (typeof blocked === 'string') { reject(blocked); continue; } // prettier-ignore
      accept();
    }
  }
  return { accepted, rejected };
}

/** Verifica finale sul testo del documento generato: nessuna tecnologia fuori da quelle possedute. */
export function inventedTechnologies(finalText: string, structure: CvStructure, extraSkills: string[]): string[] {
  const allowed = allowedTechnologies(structure, extraSkills);
  return findTechInText(finalText).filter((t) => !allowed.has(t));
}
