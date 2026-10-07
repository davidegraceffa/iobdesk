import { settingsSchema } from '@jobagg/shared';
import {
  BEHAVIORAL_THEMES,
  buildFeedbackPrompt,
  buildQuestionsPrompt,
  buildTurnPrompt,
  pickThemes,
  questionMix,
  questionsSchema,
  TECHNICAL_THEMES,
  turnSchema,
} from './prompts';

const settings = settingsSchema.parse({ user: { country: 'IT', has_vat_number: true } });
const job = {
  title: 'Backend Developer',
  company: 'Globex',
  descriptionText: 'We build APIs with Node.js.',
  seniority: 'senior',
  techStack: { languages: ['TypeScript'] } as never,
};

describe('prompt del colloquio', () => {
  it('metà domande tecniche, arrotondate per eccesso', () => {
    expect(questionMix(8)).toEqual({ technical: 4, behavioral: 4 });
    expect(questionMix(5)).toEqual({ technical: 3, behavioral: 2 });
  });

  it('i temi vengono pescati a caso senza ripetizioni', () => {
    const a = pickThemes(TECHNICAL_THEMES, 4, () => 0.1);
    const b = pickThemes(TECHNICAL_THEMES, 4, () => 0.9);
    expect(new Set(a).size).toBe(4);
    expect(a).not.toEqual(b);
    expect(pickThemes(BEHAVIORAL_THEMES, 99)).toHaveLength(BEHAVIORAL_THEMES.length);
  });

  it('lingua, numero di domande, temi e domande da evitare finiscono nel prompt', () => {
    const { system, user } = buildQuestionsPrompt(settings, job, 'de', 6, {
      attempt: 3,
      technicalThemes: ['security'],
      behavioralThemes: ['a failure or mistake and what was learned'],
      avoid: ['Erzähl mir von dir.'],
    });
    expect(system).toContain('in German');
    expect(system).toContain('exactly 6 questions: 3 with kind "technical" and 3 with kind "behavioral"');
    expect(system).toContain('attempt number 3');
    expect(system).toContain('security');
    expect(system).toContain('* Erzähl mir von dir.');
    expect(user).toContain('Globex');
    expect(user).toContain('TypeScript');
  });

  it('domande da colloquio vero: ragionamento e basi, niente nozioni a memoria, con piccoli aiuti', () => {
    const { system } = buildQuestionsPrompt(settings, job, 'en', 4);
    expect(system).toContain('not like a written exam');
    expect(system).toContain('NEVER ask for things that only a manual or an AI could answer from memory');
    expect(system).toContain('"hints": exactly 2 small hints in English');

    const parsed = questionsSchema(2).parse({
      questions: [
        {
          kind: 'technical',
          question: 'How would you approach a slow endpoint?',
          focus: 'Metodo di analisi',
          hints: ['Think about where time is spent.', 'Start from measuring.'],
        },
        { kind: 'behavioral', question: 'Tell me about a disagreement in your team.', focus: 'Gestione del conflitto' },
      ],
    });
    expect(parsed.questions.map((q) => q.hints.length)).toEqual([2, 0]);
  });

  it('a voce: l’aiuto è ammesso una volta per domanda e usa quelli preparati', () => {
    const base = {
      language: 'en',
      job,
      questions: [],
      current: { id: 'q1', kind: 'technical' as const, text: 'Q?', focus: 'f', hints: ['Start from measuring.'] },
      next: null,
      transcript: [],
    };
    const withHint = buildTurnPrompt({ ...base, allowed: ['next', 'hint'] });
    expect(withHint.system).toContain('"hint": the candidate is stuck');
    expect(withHint.system).toContain('Start from measuring.');
    expect(turnSchema(['next', 'hint']).parse({ action: 'hint', say: 'Try from a concrete case.' }).action).toBe(
      'hint',
    );
    const without = buildTurnPrompt({ ...base, allowed: ['next'] });
    expect(without.system).toContain('You already gave a hint on this question');
    expect(() => turnSchema(['next']).parse({ action: 'hint', say: 'x y' })).toThrow();
  });

  it('valutazione sul ragionamento, non sui termini', () => {
    const feedback = buildFeedbackPrompt(
      settings,
      job,
      'en',
      { id: 'q1', kind: 'technical', text: 'Q?', focus: 'f' },
      'answer',
      'text',
    );
    expect(feedback.system).toContain('did not use precise technical terms');
  });
});
