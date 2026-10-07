import type { CvStructure } from '@jobagg/shared';
import type { LlmProviderClient, LlmRequest } from '../llm.types';

export interface MockInterviewContext {
  count: number;
  language: string;
  title: string;
  attempt?: number;
}

export interface MockCvContext {
  structure: CvStructure;
  jobTech: string[];
}

/**
 * Provider finto, attivabile solo con LLM_PROVIDER=mock in .env: serve per i test e per provare
 * il flusso di generazione dei CV senza alcun modello. Produce modifiche deterministiche a partire
 * dalla struttura del CV, più una modifica volutamente inventata per mostrare il controllo anti-invenzione.
 */
export class MockProvider implements LlmProviderClient {
  readonly id = 'mock';

  async complete(_model: string, request: LlmRequest): Promise<string> {
    if (request.task === 'score') {
      return JSON.stringify({ score: 72, reason: 'Valutazione di prova del provider mock.', red_flags: [] });
    }
    if (request.task === 'interview_questions') {
      return JSON.stringify(this.interviewQuestions(request.mockContext as MockInterviewContext | undefined));
    }
    if (request.task === 'interview_feedback') {
      const ctx = request.mockContext as { transcript?: string } | undefined;
      const words = (ctx?.transcript ?? '').split(/\s+/).filter(Boolean).length;
      return JSON.stringify({
        score: words >= 40 ? 4 : words >= 12 ? 3 : 2,
        summary: 'Valutazione di prova del provider mock.',
        strengths: ['Risposta pertinente alla domanda (mock)'],
        improvements: ['Aggiungi un esempio concreto con il risultato ottenuto (mock)'],
        sampleAnswer: 'Risposta migliorata di prova: [inserisci un progetto reale in cui hai affrontato questo tema].',
      });
    }
    if (request.task === 'interview_turn') {
      const ctx = request.mockContext as { allowed: string[]; next: string | null; words: number; stuck?: boolean };
      // candidato bloccato → un piccolo aiuto (se ancora ammesso)
      if (ctx.stuck && ctx.allowed.includes('hint')) {
        return JSON.stringify({ action: 'hint', say: 'Prova a partire da un caso concreto. (mock)' });
      }
      // risposta corta → contro-domanda (se ancora ammessa), altrimenti si passa oltre
      if (ctx.words < 8 && ctx.allowed.includes('follow_up')) {
        return JSON.stringify({ action: 'follow_up', say: 'Puoi farmi un esempio concreto? (mock)' });
      }
      return JSON.stringify({
        action: 'next',
        say: ctx.next ? `Grazie. ${ctx.next}` : 'Grazie, il colloquio è concluso. (mock)',
      });
    }
    if (request.task === 'interview_report') {
      return JSON.stringify({
        overallScore: 3,
        summary: 'Valutazione finale di prova del provider mock.',
        content: {
          summary: 'Contenuti di prova (mock).',
          items: [
            {
              questionId: 'q1',
              score: 3,
              correct: ['Punto corretto (mock)'],
              incorrect: [],
              missing: ['Esempio concreto (mock)'],
            },
          ],
        },
        tone: { summary: 'Tono di prova (mock).', traits: ['professionale'], suggestions: ['Meno esitazioni (mock)'] },
        priorities: ['Preparare esempi concreti (mock)'],
      });
    }
    if (request.task === 'salary_estimate') {
      return JSON.stringify({
        min: 45000,
        max: 60000,
        currency: 'EUR',
        market: 'Europa (mock)',
        confidence: 'low',
        reasoning: 'Stima di prova del provider mock.',
      });
    }
    if (request.task === 'cv_ats') {
      return JSON.stringify({
        score: 78,
        summary: 'Valutazione ATS di prova del provider mock.',
        categories: [{ name: 'Parole chiave', score: 70, comment: 'Commento di prova.' }],
        issues: [{ severity: 'medium', title: 'Problema di prova (mock)', fix: 'Correzione di prova.' }],
        keywordsPresent: ['TypeScript'],
        keywordsMissing: ['Kubernetes'],
      });
    }
    if (request.task === 'cv_review') {
      const ctx = request.mockContext as MockCvContext | undefined;
      const target = ctx?.structure.paragraphs.find((p) => p.mutable && p.editable && !p.isHeading);
      return JSON.stringify({
        summary: 'Revisione di prova del provider mock.',
        suggestions: [
          ...(target
            ? [
                {
                  kind: 'rewrite',
                  title: 'Rendi più diretto questo paragrafo (mock)',
                  reason: 'Proposta di prova.',
                  priority: 'high',
                  edit: {
                    op: 'replace',
                    paragraphId: target.id,
                    newText: target.text.split(' ').reverse().join(' '),
                    sourceParagraphIds: [target.id],
                  },
                },
              ]
            : []),
          {
            kind: 'add',
            title: 'Se hai esperienza con Kubernetes, aggiungila (mock)',
            reason: 'Richiesta spesso negli annunci.',
            priority: 'medium',
          },
        ],
      });
    }
    if (request.task === 'cv_email') {
      const ctx = request.mockContext as { title?: string; company?: string } | undefined;
      return JSON.stringify({
        subject: `Candidatura per ${ctx?.title ?? 'la posizione'} (mock)`,
        greeting: `Gentile team di ${ctx?.company ?? 'selezione'},`,
        paragraphs: ['Email di prova del provider mock.', 'In allegato il mio CV.'],
        closing: 'Cordiali saluti,',
      });
    }
    if (request.task === 'cover_letter') {
      const ctx = request.mockContext as { title?: string; company?: string } | undefined;
      return JSON.stringify({
        subject: `Candidatura per ${ctx?.title ?? 'la posizione'} (mock)`,
        greeting: `Gentile team di ${ctx?.company ?? 'selezione'},`,
        paragraphs: [
          'Lettera di prova del provider mock: qui il modello collega i requisiti dell’annuncio alle esperienze del CV.',
          'Secondo paragrafo di prova: motivazione per il ruolo e per l’azienda.',
          'Terzo paragrafo di prova: disponibilità a un colloquio.',
        ],
        closing: 'Cordiali saluti,',
      });
    }
    if (request.task === 'analysis') {
      return JSON.stringify({
        requiredRequirements: ['Esperienza con le tecnologie indicate nell’annuncio'],
        preferredRequirements: ['Kubernetes'],
        atsKeywords: [],
        seniority: 'unknown',
      });
    }
    return JSON.stringify(this.cvEdits(request.mockContext as MockCvContext | undefined));
  }

  private interviewQuestions(ctx: MockInterviewContext | undefined) {
    const count = ctx?.count ?? 6;
    const technical = Math.ceil(count / 2);
    return {
      brief: {
        summary: 'Riepilogo di prova del provider mock: il ruolo e cosa cerca l’azienda.',
        topics: ['Tecnologie dell’annuncio', 'Progettazione', 'Lavoro in team'].map((title) => ({
          title,
          detail: 'Tema di prova (mock).',
        })),
      },
      questions: Array.from({ length: count }, (_, i) => {
        const kind = i % 2 === 1 && i < (count - technical) * 2 ? 'behavioral' : 'technical';
        return {
          kind,
          question:
            kind === 'technical'
              ? `Domanda tecnica di prova ${i + 1} sul ruolo "${ctx?.title ?? 'annuncio'}" (tentativo ${ctx?.attempt ?? 1})?`
              : `Domanda comportamentale di prova ${i + 1} (tentativo ${ctx?.attempt ?? 1}): raccontami un episodio di lavoro in team?`,
          focus: 'Domanda di prova del provider mock.',
          hints: ['Primo aiuto di prova (mock).', 'Secondo aiuto di prova (mock).'],
        };
      }),
    };
  }

  private cvEdits(ctx: MockCvContext | undefined) {
    const edits: unknown[] = [];
    const structure = ctx?.structure;
    if (structure) {
      const usable = (sectionType: string, bulletsOnly = false) =>
        structure.sections
          .filter((s) => s.type === sectionType)
          .flatMap((s) => s.paragraphIds.map((id) => structure.paragraphs.find((p) => p.id === id)!))
          .filter((p) => p && p.mutable && p.editable && !p.isHeading && (!bulletsOnly || p.isBullet));

      const summary = usable('summary')[0];
      if (summary) {
        const sentences = summary.text.split(/(?<=[.!?])\s+/).filter(Boolean);
        const reordered = sentences.length > 1 ? [...sentences.slice(1), sentences[0]].join(' ') : summary.text;
        edits.push({
          op: 'replace',
          paragraphId: summary.id,
          newText: reordered,
          sourceParagraphIds: [summary.id],
          reason: 'Sommario riordinato per mettere in primo piano ciò che chiede l’annuncio (mock)',
        });
      }
      const expSection = structure.sections.find((s) => s.type === 'experience');
      const bullets = usable('experience', true).filter((p) => expSection?.paragraphIds.includes(p.id));
      if (expSection && bullets.length >= 2) {
        const [first, second] = bullets as [(typeof bullets)[number], (typeof bullets)[number]];
        edits.push({
          op: 'reorder',
          sectionId: expSection.id,
          paragraphIds: [second.id, first.id],
          reason: 'Bullet più pertinente spostato in alto (mock)',
        });
        // modifica volutamente inventata: deve essere scartata dal controllo anti-invenzione
        edits.push({
          op: 'replace',
          paragraphId: first.id,
          newText: `${first.text} Deploy su Kubernetes con Terraform.`,
          sourceParagraphIds: [first.id],
          reason: 'Aggiunta di tecnologie richieste dall’annuncio (mock: da scartare)',
        });
      }
    }
    return {
      edits,
      gaps: [
        {
          requirement: 'Kubernetes',
          importance: 'preferred',
          suggestion: 'Se hai esperienza con Kubernetes, aggiungila alle competenze aggiuntive nel Profilo.',
        },
      ],
      matchSummary: { covered: ctx?.jobTech.slice(0, 3) ?? [], partiallyCovered: [], missing: ['Kubernetes'] },
    };
  }
}
