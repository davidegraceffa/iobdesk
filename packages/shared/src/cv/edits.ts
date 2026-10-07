import { z } from 'zod';

/** Sezioni riconosciute in un CV. */
export const CV_SECTION_TYPES = [
  'personal',
  'summary',
  'skills',
  'experience',
  'education',
  'languages',
  'other',
] as const;
export type CvSectionType = (typeof CV_SECTION_TYPES)[number];

export type CvSectionOverride = CvSectionType | 'not_heading';

export interface CvParagraph {
  /** id stabile: posizione del paragrafo nel documento (p0, p1, …) */
  id: string;
  text: string;
  style?: string;
  isHeading: boolean;
  isBullet: boolean;
  sectionId: string;
  /** false se il paragrafo ha run con stili diversi, link, campi o immagini: il testo non si può sostituire in sicurezza */
  editable: boolean;
  /** motivo per cui il testo non è modificabile, se `editable` è false */
  notEditableReason?: string;
  /** tipo di sezione riconosciuto automaticamente se il paragrafo è un'intestazione (prima delle correzioni manuali) */
  autoHeading: CvSectionType | null;
  /** il paragrafo sta in una casella di testo: sono permesse solo sostituzioni di testo */
  inTextBox?: boolean;
  /** true se le regole permettono di modificarlo (sommario, competenze, bullet delle esperienze) */
  mutable: boolean;
}

export interface CvSection {
  id: string;
  type: CvSectionType;
  title: string;
  /** paragrafo di intestazione, assente per la sezione iniziale dei dati personali */
  headingParagraphId?: string;
  paragraphIds: string[];
}

export interface CvStructure {
  paragraphs: CvParagraph[];
  sections: CvSection[];
  /**
   * correzioni manuali dell'utente, per id di paragrafo: un tipo di sezione significa
   * "questo paragrafo è l'intestazione di una sezione di quel tipo"; `not_heading` annulla un'intestazione riconosciuta per errore
   */
  overrides: Record<string, CvSectionOverride>;
  /** nome del candidato, usato per il nome dei file scaricati */
  candidateName: string;
}

const idList = z.array(z.string().min(1)).max(50);

export const cvEditSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('replace'),
    paragraphId: z.string().min(1),
    newText: z.string().min(1).max(2000),
    sourceParagraphIds: idList.default([]),
    extraSkills: z.array(z.string()).max(50).optional(),
    reason: z.string().max(500).default(''),
  }),
  z.object({
    op: z.literal('reorder'),
    sectionId: z.string().min(1),
    paragraphIds: idList,
    reason: z.string().max(500).default(''),
  }),
  z.object({
    op: z.literal('remove'),
    paragraphId: z.string().min(1),
    reason: z.string().max(500).default(''),
  }),
  z.object({
    op: z.literal('insert_after'),
    afterParagraphId: z.string().min(1),
    cloneStyleFrom: z.string().min(1),
    newText: z.string().min(1).max(2000),
    sourceParagraphIds: idList.default([]),
    extraSkills: z.array(z.string()).max(50).optional(),
    reason: z.string().max(500).default(''),
  }),
]);
export type CvEdit = z.infer<typeof cvEditSchema>;

export const cvEditsSchema = z.object({
  edits: z.array(cvEditSchema).max(80).default([]),
  gaps: z
    .array(
      z.object({
        requirement: z.string().max(300),
        importance: z.enum(['required', 'preferred']).catch('preferred'),
        suggestion: z.string().max(600).default(''),
      }),
    )
    .max(40)
    .default([]),
  matchSummary: z
    .object({
      covered: z.array(z.string().max(300)).max(60).default([]),
      partiallyCovered: z.array(z.string().max(300)).max(60).default([]),
      missing: z.array(z.string().max(300)).max(60).default([]),
    })
    .prefault({}),
});
export type CvEdits = z.infer<typeof cvEditsSchema>;

/** Modifica salvata: quella dell'LLM più lo stato deciso dall'utente. */
export type AppliedCvEdit = CvEdit & {
  id: string;
  /** accepted: applicata; rejected: rifiutata dall'utente, il paragrafo torna all'originale */
  status: 'accepted' | 'rejected';
  /** testo ritoccato a mano dall'utente (solo replace / insert_after) */
  manualText?: string;
};

export interface RejectedCvEdit {
  edit: unknown;
  /** motivo dello scarto, es. "Tecnologia non presente nel CV: Kubernetes" */
  reason: string;
}

export const jobAnalysisSchema = z.object({
  requiredRequirements: z.array(z.string().max(300)).max(40).default([]),
  preferredRequirements: z.array(z.string().max(300)).max(40).default([]),
  atsKeywords: z.array(z.string().max(80)).max(60).default([]),
  seniority: z.string().max(40).default('unknown'),
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

/** Lettera di candidatura proposta dall'LLM: la firma con il nome viene aggiunta in locale. */
export const coverLetterSchema = z.object({
  /** oggetto della lettera, es. "Candidatura per Senior Backend Engineer" */
  subject: z.string().min(1).max(200),
  greeting: z.string().min(1).max(200),
  paragraphs: z.array(z.string().min(1).max(2500)).min(2).max(6),
  /** formula di chiusura, es. "Cordiali saluti," */
  closing: z.string().min(1).max(200),
});
export type CoverLetterDraft = z.infer<typeof coverLetterSchema>;

export const llmScoreSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  reason: z.string().max(1500).default(''),
  red_flags: z.array(z.string().max(300)).max(20).default([]),
});
export type LlmScore = z.infer<typeof llmScoreSchema>;

export const CV_REVIEW_KINDS = ['rewrite', 'add', 'remove', 'structure'] as const;
export type CvReviewKind = (typeof CV_REVIEW_KINDS)[number];

/** Revisione di un CV base proposta dall'LLM. */
export const cvReviewSchema = z.object({
  summary: z.string().max(1500).default(''),
  suggestions: z
    .array(
      z.object({
        kind: z.enum(CV_REVIEW_KINDS).catch('structure'),
        title: z.string().min(1).max(200),
        reason: z.string().max(800).default(''),
        priority: z.enum(['high', 'medium', 'low']).catch('medium'),
        /**
         * la modifica al documento che realizza la proposta, nello stesso formato dei CV su misura;
         * assente per domande al candidato e consigli che non si possono applicare da soli
         */
        edit: cvEditSchema.nullish().catch(null),
      }),
    )
    .max(20)
    .default([]),
});

/** Valutazione di compatibilità ATS di un CV base proposta dall'LLM. */
export const cvAtsSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  summary: z.string().max(1500).default(''),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        score: z.coerce.number().min(0).max(100),
        comment: z.string().max(600).default(''),
      }),
    )
    .max(8)
    .default([]),
  issues: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']).catch('medium'),
        title: z.string().min(1).max(200),
        fix: z.string().max(600).default(''),
      }),
    )
    .max(12)
    .default([]),
  keywordsPresent: z.array(z.string().max(80)).max(40).default([]),
  keywordsMissing: z.array(z.string().max(80)).max(40).default([]),
});

/** Email di accompagnamento proposta dall'LLM: breve, la firma con il nome viene aggiunta in locale. */
export const cvEmailSchema = z.object({
  subject: z.string().min(1).max(200),
  greeting: z.string().min(1).max(200),
  paragraphs: z.array(z.string().min(1).max(1200)).min(1).max(4),
  closing: z.string().min(1).max(200),
});

/** Stima della RAL proposta dall'LLM per un annuncio che non la indica: sempre lorda annua. */
export const salaryEstimateSchema = z.object({
  min: z.coerce.number().min(1000).max(5_000_000),
  max: z.coerce.number().min(1000).max(5_000_000),
  currency: z.string().trim().toUpperCase().length(3),
  /** mercato del lavoro a cui si riferisce la stima, es. "Germania" */
  market: z.string().max(120).default(''),
  confidence: z.enum(['low', 'medium', 'high']).catch('low'),
  reasoning: z.string().max(1500).default(''),
});
export type SalaryEstimateDraft = z.infer<typeof salaryEstimateSchema>;

/** Stima salvata sull'annuncio. */
export interface StoredSalaryEstimate extends SalaryEstimateDraft {
  provider: string;
  model: string;
  createdAt: string;
}

export const CV_PROGRESS_STEPS = ['queued', 'analysis', 'adaptation', 'layout', 'preview', 'ready', 'failed'] as const;
export type CvProgressStep = (typeof CV_PROGRESS_STEPS)[number];

export interface CvProgressEvent {
  generatedCvId: string;
  step: CvProgressStep;
  message?: string;
}
