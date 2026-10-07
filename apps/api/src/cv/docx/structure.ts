import type { CvParagraph, CvSection, CvSectionOverride, CvSectionType, CvStructure } from '@jobagg/shared';

/** Dati di un paragrafo letti dal DOCX, prima dell'assegnazione alle sezioni. */
export interface RawParagraph {
  id: string;
  text: string;
  style?: string;
  isBullet: boolean;
  editable: boolean;
  notEditableReason?: string;
  headingStyle: boolean;
  inTextBox: boolean;
}

/** Parole chiave delle intestazioni di sezione nelle lingue supportate (it, en, es, de, fr, pt, nl). */
const SECTION_KEYWORDS: Record<Exclude<CvSectionType, 'other'>, string[]> = {
  personal: [
    'contatti', 'contatto', 'dati personali', 'informazioni personali', 'contact', 'contacts', 'contact details',
    'personal details', 'personal information', 'contacto', 'datos personales', 'kontakt', 'persönliche daten',
    'coordonnées', 'contacto', 'dados pessoais', 'persoonlijke gegevens',
  ],
  summary: [
    'profilo', 'profilo professionale', 'sommario', 'chi sono', 'presentazione', 'obiettivo', 'obiettivo professionale',
    'summary', 'professional summary', 'profile', 'professional profile', 'about', 'about me', 'objective', 'career objective',
    'resumen', 'perfil', 'perfil profesional', 'sobre mí', 'profil', 'zusammenfassung', 'über mich', 'kurzprofil',
    'à propos', 'résumé', 'resumo', 'perfil profissional', 'sobre mim', 'profiel', 'samenvatting', 'over mij',
  ],
  skills: [
    'competenze', 'competenze tecniche', 'competenze professionali', 'capacità e competenze', 'tecnologie', 'strumenti',
    'skills', 'technical skills', 'core skills', 'key skills', 'tech stack', 'technologies', 'tools', 'hard skills', 'soft skills',
    'competencias', 'habilidades', 'aptitudes', 'kenntnisse', 'fähigkeiten', 'kompetenzen', 'technische kenntnisse',
    'compétences', 'compétences techniques', 'competências', 'vaardigheden', 'technische vaardigheden',
  ],
  experience: [
    'esperienza', 'esperienze', 'esperienza professionale', 'esperienze professionali', 'esperienza lavorativa',
    'esperienze lavorative', 'experience', 'work experience', 'professional experience', 'employment', 'employment history',
    'work history', 'career history', 'experiencia', 'experiencia profesional', 'experiencia laboral', 'erfahrung',
    'berufserfahrung', 'beruflicher werdegang', 'expérience', 'expérience professionnelle', 'expériences',
    'experiência', 'experiência profissional', 'werkervaring', 'ervaring',
  ],
  education: [
    'formazione', 'istruzione', 'istruzione e formazione', 'studi', 'titoli di studio', 'certificazioni', 'corsi',
    'education', 'studies', 'academic background', 'certifications', 'courses', 'training', 'education and training',
    'educación', 'formación', 'formación académica', 'certificaciones', 'ausbildung', 'bildung', 'studium', 'zertifikate',
    'formation', 'études', 'certifications', 'formação', 'educação', 'certificações', 'opleiding', 'opleidingen', 'certificaten',
  ],
  languages: ['lingue', 'lingue straniere', 'languages', 'idiomas', 'sprachen', 'sprachkenntnisse', 'langues', 'línguas', 'talen'],
}; // prettier-ignore

const KEYWORD_INDEX: Array<[string, CvSectionType]> = (
  Object.entries(SECTION_KEYWORDS) as Array<[CvSectionType, string[]]>
)
  .flatMap(([type, words]) => words.map((w) => [w, type] as [string, CvSectionType]))
  .sort((a, b) => b[0].length - a[0].length);

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[:•|_\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Riconosce un'intestazione di sezione dal testo: righe brevi che coincidono con una parola chiave nota. */
export function guessHeading(p: Pick<RawParagraph, 'text' | 'headingStyle' | 'isBullet'>): CvSectionType | null {
  const text = normalizeHeading(p.text);
  if (!text || p.isBullet) return null;
  // "Lingue: italiano, inglese" è una riga di contenuto, non un'intestazione
  if (/[:：]\s*\S/.test(p.text)) return null;
  const words = text.split(' ').length;
  if (text.length <= 48 && words <= 5) {
    for (const [keyword, type] of KEYWORD_INDEX) {
      if (text === keyword || text.startsWith(`${keyword} `) || text.endsWith(` ${keyword}`)) return type;
    }
  }
  // stile "Heading/Titolo N" senza parola chiave nota: sezione generica
  if (p.headingStyle && text.length <= 60) return 'other';
  return null;
}

const MUTABLE_SECTIONS: CvSectionType[] = ['summary', 'skills', 'experience'];

/** Regole su cosa si può modificare: sommario e competenze per intero, delle esperienze solo i bullet. */
function isMutable(sectionType: CvSectionType, isHeading: boolean, isBullet: boolean): boolean {
  if (isHeading) return false;
  if (sectionType === 'summary' || sectionType === 'skills') return true;
  if (sectionType === 'experience') return isBullet;
  return false;
}

export function isMutableSection(type: CvSectionType): boolean {
  return MUTABLE_SECTIONS.includes(type);
}

/**
 * Assegna i paragrafi alle sezioni. Funzione pura: a partire dai paragrafi letti dal DOCX e dalle
 * correzioni manuali dell'utente produce sempre la stessa struttura.
 */
export function computeStructure(raws: RawParagraph[], overrides: Record<string, CvSectionOverride> = {}): CvStructure {
  const sections: CvSection[] = [{ id: 's0', type: 'personal', title: 'Dati personali', paragraphIds: [] }];
  const paragraphs: CvParagraph[] = [];

  for (const raw of raws) {
    const autoHeading = guessHeading(raw);
    const override = overrides[raw.id];
    const headingType: CvSectionType | null = override === 'not_heading' ? null : (override ?? autoHeading);

    if (headingType) {
      sections.push({
        id: `s${sections.length}`,
        type: headingType,
        title: raw.text.trim(),
        headingParagraphId: raw.id,
        paragraphIds: [],
      });
    }
    const section = sections[sections.length - 1]!;
    if (!headingType) section.paragraphIds.push(raw.id);
    paragraphs.push({
      id: raw.id,
      text: raw.text,
      style: raw.style,
      isHeading: !!headingType,
      isBullet: raw.isBullet,
      sectionId: section.id,
      editable: raw.editable,
      notEditableReason: raw.notEditableReason,
      autoHeading,
      inTextBox: raw.inTextBox || undefined,
      mutable: isMutable(section.type, !!headingType, raw.isBullet),
    });
  }

  // nome del candidato: il paragrafo con stile "Titolo", altrimenti la prima riga dei dati personali
  const personal = sections[0]!;
  const titled = paragraphs.find((p) => /^(?:title|titolo|titel|titre|t[ií]tulo)$/i.test(p.style ?? ''));
  const firstLine = titled?.text ?? paragraphs.find((p) => personal.paragraphIds.includes(p.id))?.text ?? '';
  return {
    paragraphs,
    sections: sections.filter((s) => s.paragraphIds.length > 0 || s.headingParagraphId),
    overrides,
    candidateName: firstLine
      .split(/[\n\t|·•,]/)[0]!
      .trim()
      .slice(0, 80),
  };
}

/** Estrae i paragrafi "grezzi" da una struttura salvata, per ricalcolarla dopo una correzione manuale. */
export function toRawParagraphs(structure: CvStructure): RawParagraph[] {
  return structure.paragraphs.map((p) => ({
    id: p.id,
    text: p.text,
    style: p.style,
    isBullet: p.isBullet,
    editable: p.editable,
    notEditableReason: p.notEditableReason,
    headingStyle: p.autoHeading === 'other',
    inTextBox: !!p.inTextBox,
  }));
}
