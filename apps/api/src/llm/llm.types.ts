export type LlmTask =
  | 'score'
  | 'analysis'
  | 'cv_edits'
  | 'cover_letter'
  | 'cv_email'
  | 'cv_review'
  | 'cv_ats'
  | 'salary_estimate'
  | 'interview_questions'
  | 'interview_feedback'
  | 'interview_turn'
  | 'interview_report';

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens?: number;
  /** risposta breve da dare subito (conversazione): modello rapido, senza ragionamento esteso */
  fast?: boolean;
  /** dati strutturati usati solo dal provider finto dei test/demo; i provider reali li ignorano */
  mockContext?: unknown;
}

export interface LlmProviderClient {
  readonly id: string;
  /** Restituisce il testo della risposta, che deve contenere un oggetto JSON. */
  /** `onText`: se il provider sa farlo, riceve i pezzi di testo man mano che il modello li scrive. */
  complete(model: string, request: LlmRequest, onText?: (delta: string) => void): Promise<string>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}
