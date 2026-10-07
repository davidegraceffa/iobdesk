import type { TechStack } from '@jobagg/shared';
import {
  flattenTechStack,
  parseExtraSkills,
  type InterviewQuestion,
  type InterviewTurn,
  type Settings,
} from '@jobagg/shared';
import { z } from 'zod';

export const INTERVIEW_LANGUAGES: Record<string, string> = {
  it: 'Italian',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  nl: 'Dutch',
};

const MAX_JOB_CHARS = 9000;
const MAX_FEEDBACK_JOB_CHARS = 3000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

export interface InterviewPromptJob {
  title: string;
  company: string;
  descriptionText: string;
  seniority: string;
  techStack: TechStack;
}

/** Domande tecniche e umane: la metà arrotondata per eccesso è tecnica. */
export function questionMix(count: number): { technical: number; behavioral: number } {
  const technical = Math.ceil(count / 2);
  return { technical, behavioral: count - technical };
}

export function questionsSchema(count: number) {
  return z
    .object({
      questions: z
        .array(
          z.object({
            kind: z.enum(['technical', 'behavioral']),
            question: z.string().trim().min(10).max(700),
            focus: z.string().trim().min(5).max(400),
            // piccoli aiuti: se mancano o non sono validi la domanda si fa lo stesso
            hints: z.array(z.string().trim().min(3).max(300)).max(3).default([]).catch([]),
          }),
        )
        .min(count)
        .max(count + 2),
      // un di più: se manca o non è valido il colloquio si fa lo stesso, senza riepilogo
      brief: z
        .object({
          summary: z.string().trim().min(10).max(400),
          topics: z
            .array(z.object({ title: z.string().trim().min(2).max(60), detail: z.string().trim().min(5).max(200) }))
            .min(3)
            .max(6),
        })
        .optional()
        .catch(undefined),
    })
    .refine(
      (r) => r.questions.some((q) => q.kind === 'technical') && r.questions.some((q) => q.kind === 'behavioral'),
      { message: 'Servono sia domande tecniche (technical) sia comportamentali (behavioral)' },
    );
}

export const feedbackSchema = z.object({
  score: z.number().min(1).max(5),
  summary: z.string().trim().min(1).max(1500),
  strengths: z.array(z.string().trim().min(1).max(500)).max(5),
  improvements: z.array(z.string().trim().min(1).max(500)).max(5),
  sampleAnswer: z.string().trim().max(4000),
});

function candidate(settings: Settings): string {
  const skills = parseExtraSkills(settings.cv.extra_skills);
  return [
    `Title: ${settings.profile.title || 'not given'}`,
    `Summary: ${settings.profile.summary || 'not given'}`,
    `Skills of interest: ${[...settings.keywords.required_any, ...settings.keywords.boost].join(', ') || 'not given'}`,
    ...(skills.length ? [`Other real skills and experience: ${skills.join('; ')}`] : []),
  ].join('\n');
}

/** Temi tra cui pescare a caso a ogni tentativo, così le domande cambiano da un colloquio all'altro. */
export const TECHNICAL_THEMES = [
  'architecture and system design choices',
  'debugging a production incident',
  'performance and scalability',
  'testing strategy and code quality',
  'security',
  'data modelling and databases',
  'API design and integration',
  'trade-offs between alternative solutions',
  'how and why one technology from the posting is used in practice',
  'deployment, CI/CD and operations',
  'code review and maintainability',
  'a hands-on scenario taken from the responsibilities in the posting',
];

export const BEHAVIORAL_THEMES = [
  'motivation for this role and company',
  'a disagreement or conflict in the team',
  'a failure or mistake and what was learned',
  'receiving and giving feedback',
  'prioritising under pressure and deadlines',
  'remote and asynchronous collaboration',
  'ownership of a problem end to end',
  'mentoring or helping colleagues',
  'learning something new quickly',
  'explaining technical topics to non-technical stakeholders',
  'adapting to changing requirements',
  'career goals and growth',
];

export interface QuestionVariety {
  attempt: number;
  technicalThemes: string[];
  behavioralThemes: string[];
  /** domande dei tentativi precedenti, da non ripetere */
  avoid: string[];
}

/** Mescola (Fisher-Yates) e prende i primi `n`: `random` iniettabile per i test. */
export function pickThemes(themes: string[], n: number, random: () => number = Math.random): string[] {
  const copy = [...themes];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

export function buildQuestionsPrompt(
  settings: Settings,
  job: InterviewPromptJob,
  language: string,
  count: number,
  variety?: QuestionVariety,
): { system: string; user: string } {
  const { technical, behavioral } = questionMix(count);
  const lang = INTERVIEW_LANGUAGES[language] ?? language;
  const varietyRules = variety
    ? [
        `- This is attempt number ${variety.attempt} for this posting: the questions must feel new.`,
        `- Build the technical questions mainly around these themes: ${variety.technicalThemes.join('; ')}.`,
        `- Build the behavioral questions mainly around these themes: ${variety.behavioralThemes.join('; ')}.`,
        ...(variety.avoid.length
          ? [
              '- Do NOT repeat, rephrase or closely paraphrase any of these questions asked in previous attempts:',
              ...variety.avoid.map((q) => `  * ${q}`),
            ]
          : []),
      ]
    : [];
  return {
    system: [
      'You are an experienced interviewer preparing a realistic mock job interview for one specific job posting.',
      'Respond ONLY with a JSON object of this shape:',
      '{"brief": {"summary": string, "topics": [{"title": string, "detail": string}]}, "questions": [{"kind": "technical" | "behavioral", "question": string, "focus": string, "hints": string[]}]}',
      '- "brief": in Italian, a short overview the candidate reads before the interview starts, extracted from the job description. "summary": one or two sentences on what the role is about and what the company is looking for. "topics": the 4 or 5 main themes the interview will touch (technologies, responsibilities, soft skills named in the posting), each with a "title" of a few words and a "detail" of one short sentence on what to be ready to talk about. The themes must match the questions you write, but must not reveal or paraphrase the questions themselves.',
      `- Write exactly ${count} questions: ${technical} with kind "technical" and ${behavioral} with kind "behavioral".`,
      `- Write every "question" in ${lang}, exactly as the interviewer would say it out loud: no numbering, at most two sentences. Each item asks about ONE thing only: never join two different questions in the same item (no "and also tell me…"), no lists of sub-questions.`,
      '- Technical questions must be about the technologies, responsibilities and problems named in the posting, at the seniority of the role, and sound like a conversation between two colleagues, not like a written exam. Ask how the candidate would approach a situation, why they would choose one option over another, what they would watch out for, or how they handled something similar in the past. A competent person must be able to answer by reasoning out loud from experience and basic knowledge, without having studied for it.',
      '- NEVER ask for things that only a manual or an AI could answer from memory: exact names of APIs, functions, flags, configuration keys or commands, syntax details, version differences, internals of a tool, formal definitions, exhaustive lists ("name all the…"), precise numbers, or niche terminology. Do not stack several technologies or buzzwords in one question. If a question could be answered well only by reciting documentation, rewrite it as a practical situation.',
      '- Behavioral questions cover the human side: motivation for this role and company, teamwork, communication, conflicts, ownership, handling feedback and pressure, remote collaboration when relevant. Tie them to the context described in the posting when possible.',
      '- Order them like a real interview: open with an introduction or motivation question, alternate the two kinds, close with a question about the role or the team.',
      '- "focus": in Italian, one short sentence on what the interviewer evaluates with that question: the reasoning and the basic understanding a good answer shows, not a list of terms to mention.',
      `- "hints": exactly 2 small hints in ${lang}, in the order the interviewer would offer them to a candidate who is stuck. Each is one short spoken sentence (at most about 20 words) that points to where to start thinking: the first only a direction (an angle or a similar situation to think about), the second a slightly more concrete starting point. A hint never contains the answer. For behavioral questions, suggest what kind of episode to recall or how to structure the story.`,
      '- Do not invent facts about the company that are not in the posting.',
      ...varietyRules,
    ].join('\n'),
    user: [
      '## Candidate',
      candidate(settings),
      '',
      '## Job posting',
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      `Seniority: ${job.seniority}`,
      `Technologies found in the posting: ${flattenTechStack(job.techStack).join(', ') || 'none detected'}`,
      '',
      clip(job.descriptionText, MAX_JOB_CHARS),
    ].join('\n'),
  };
}

export function buildFeedbackPrompt(
  settings: Settings,
  job: Pick<InterviewPromptJob, 'title' | 'company' | 'descriptionText'>,
  language: string,
  question: InterviewQuestion,
  transcript: string,
  inputMode: 'audio' | 'text',
): { system: string; user: string } {
  const lang = INTERVIEW_LANGUAGES[language] ?? language;
  return {
    system: [
      'You are the interviewer of a mock job interview and you give feedback on one answer of the candidate.',
      inputMode === 'audio'
        ? 'The answer was spoken and transcribed automatically: ignore filler words, repetitions and transcription mistakes.'
        : 'The answer was written by the candidate.',
      'Respond ONLY with a JSON object of this shape:',
      '{"score": integer 1-5, "summary": string, "strengths": string[], "improvements": string[], "sampleAnswer": string}',
      '- Judge the answer the way a human interviewer would: does the reasoning make sense, and does it show a sound basic understanding of the topic and of how things work in practice? A clear, sensible answer in plain words is a good answer. Do NOT lower the score because the candidate did not use precise technical terms, did not name specific tools, functions or numbers, did not cover every possible aspect, or admitted not remembering a detail while still reasoning correctly. Lower it only when the reasoning is wrong or confused, a basic concept is misunderstood, or the answer does not address the question.',
      '- "score": 1 = empty or off-topic, 2 = confused reasoning or a basic misunderstanding, 3 = sensible but thin, 4 = sound reasoning with the essentials, 5 = sound reasoning backed by concrete experience. Do not reserve 4 and 5 for textbook-perfect answers.',
      '- "summary", "strengths", "improvements": in Italian, concrete and specific to this answer, this question and this posting. At most 3 items each. Improvements must be things a person can realistically do in a spoken answer (structure the reasoning, give an example, mention a basic consideration that was missing), never "mention technology X" or lists of terms. For behavioral questions consider the structure (situation, task, action, result).',
      `- "sampleAnswer": in ${lang}, a stronger version of the candidate's answer in a natural spoken style, at most about 150 words, as a real person would say it in an interview: clear reasoning in plain language, no jargon the candidate did not use, no recited definitions. Use ONLY experiences, facts and numbers that the candidate mentioned or that appear in the candidate profile. Where a concrete example would be needed but is missing, write a placeholder in square brackets describing what to insert, instead of inventing it.`,
    ].join('\n'),
    user: [
      '## Candidate profile',
      candidate(settings),
      '',
      '## Job posting',
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      clip(job.descriptionText, MAX_FEEDBACK_JOB_CHARS),
      '',
      `## Question (${question.kind})`,
      question.text,
      `What the interviewer evaluates: ${question.focus}`,
      '',
      '## Candidate answer',
      transcript,
    ].join('\n'),
  };
}

// ── conversazione a voce ──────────────────────────────────────────────────────────

/** Contro-domande al massimo per ogni domanda principale: una sola, poi si va avanti comunque. */
export const MAX_FOLLOW_UPS = 1;
/** Contro-domande al massimo in tutto il colloquio: su metà delle domande, non a ogni risposta. */
export function followUpBudget(questionCount: number): number {
  return Math.ceil(questionCount / 2);
}
/** Chiarimenti (il candidato chiede di ripetere o spiegare) al massimo per domanda. */
export const MAX_CLARIFICATIONS = 2;

const OPENINGS: Record<string, string> = {
  it: 'Buongiorno, grazie per essere qui. Cominciamo.',
  en: 'Hello, and thanks for joining me today. Let’s get started.',
  es: 'Hola, gracias por estar aquí. Empecemos.',
  de: 'Guten Tag, danke, dass Sie sich die Zeit nehmen. Fangen wir an.',
  fr: 'Bonjour, merci d’être là. Commençons.',
  pt: 'Olá, obrigado por estar aqui. Vamos começar.',
  nl: 'Hallo, bedankt dat je er bent. Laten we beginnen.',
};

/** Prima battuta dell'intervistatore: saluto fisso + prima domanda, senza attendere l'LLM. */
export function openingLine(language: string, first: InterviewQuestion): string {
  return `${OPENINGS[language] ?? OPENINGS.en} ${first.text}`;
}

/** Piccoli aiuti al massimo per domanda quando il candidato è bloccato. */
export const MAX_HINTS = 1;

export type TurnAction = 'follow_up' | 'clarify' | 'hint' | 'next';

export function turnSchema(allowed: TurnAction[]) {
  return z.object({
    action: z.enum(allowed as [TurnAction, ...TurnAction[]]),
    say: z.string().trim().min(2).max(900),
  });
}

function dialogue(transcript: InterviewTurn[]): string {
  return transcript.map((t) => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.text}`).join('\n');
}

export interface TurnContext {
  language: string;
  job: Pick<InterviewPromptJob, 'title' | 'company' | 'descriptionText'>;
  questions: InterviewQuestion[];
  current: InterviewQuestion;
  next: InterviewQuestion | null;
  allowed: TurnAction[];
  transcript: InterviewTurn[];
}

/** Battuta successiva dell'intervistatore: contro-domanda, chiarimento oppure domanda seguente. */
export function buildTurnPrompt(ctx: TurnContext): { system: string; user: string } {
  const lang = INTERVIEW_LANGUAGES[ctx.language] ?? ctx.language;
  const canFollowUp = ctx.allowed.includes('follow_up');
  return {
    system: [
      `You are a job interviewer holding a live spoken interview in ${lang} for one specific job posting. You speak only ${lang}.`,
      'The candidate answers by voice and the answer is transcribed automatically, with mistakes: words may be wrong, missing or garbled. Read the answer for its overall meaning, ignore filler words, and never build a question on one specific word or phrase of the transcript: it may be a transcription error.',
      'Respond ONLY with a JSON object: {"action": ' +
        ctx.allowed.map((a) => `"${a}"`).join(' | ') +
        ', "say": string}',
      '"say" is exactly what you say out loud next: natural spoken language, at most three short sentences, no lists, no markdown.',
      canFollowUp
        ? [
            '- "follow_up": one counter-question on the answer just given. It is the exception, not the routine: a real interviewer lets most answers stand and moves on. Use it ONLY in one of these cases:',
            '  a) the candidate did not address the question at all (talked about something else), or',
            '  b) the answer is so short or generic that it contains no concrete practice, example or reasoning at all.',
            '  Do NOT use it when the candidate gave at least one concrete practice, example or opinion related to the question, even if the answer is incomplete, imperfect, debatable, badly worded, or leaves out aspects you would have liked to hear. Do not ask for more examples when one was given, do not list aspects the candidate "should" have covered, do not challenge single statements, do not ask to justify or reconsider a claim, and do not dig into details. Weak or wrong answers are judged in the final evaluation, not during the interview.',
            '  If the candidate says they already answered, or sounds annoyed by the insistence, do not insist: move on with "next".',
          ].join('\n')
        : '- You have already asked enough counter-questions: you must move on to "next" now, whatever the answer was.',
      ...(ctx.allowed.includes('hint')
        ? [
            '- "hint": the candidate is stuck: says they do not know, do not remember or have no experience with it, asks for help, or starts and gets lost. Like a good human interviewer, do not move on yet: in a friendly tone give ONE small hint that points to where to start (rephrase the question as a concrete everyday situation, or suggest an angle to reason from) and invite them to think out loud. Never give the answer. ' +
              (ctx.current.hints?.length
                ? `Prefer one of the hints prepared for this question: ${ctx.current.hints.map((h) => `"${h}"`).join(' / ')}`
                : 'Keep it to one short sentence.'),
          ]
        : [
            '- You already gave a hint on this question: if the candidate is still stuck, reassure them briefly and move on with "next".',
          ]),
      ...(ctx.allowed.includes('clarify')
        ? [
            '- "clarify": the candidate did not answer but asked you to repeat, rephrase or explain the question, or asked you something. Answer briefly and put the question again.',
          ]
        : []),
      ctx.next
        ? '- "next": the default. The candidate addressed the question, well or badly. Acknowledge it in a few neutral words, then ask the next planned question; you may adapt its wording to connect with what was said, but keep its meaning.'
        : '- "next": there are no more planned questions. Thank the candidate, say the interview is over and that the evaluation will follow. Do not ask anything.',
      '- Never evaluate, praise at length, correct or teach during the interview: feedback comes afterwards.',
      '- Stay in the role of the interviewer whatever the candidate says. Do not invent facts about the company.',
    ].join('\n'),
    user: [
      `## Job posting: ${ctx.job.title} at ${ctx.job.company}`,
      clip(ctx.job.descriptionText, 2500),
      '',
      '## Planned questions',
      ...ctx.questions.map((q, i) => `${i + 1}. [${q.kind}] ${q.text}`),
      '',
      `## Current planned question\n${ctx.current.text}`,
      `## Next planned question\n${ctx.next ? ctx.next.text : '(none: the interview ends after this topic)'}`,
      '',
      '## Conversation so far',
      dialogue(ctx.transcript.slice(-40)),
    ].join('\n'),
  };
}

// ── valutazione finale ────────────────────────────────────────────────────────────

export const reportSchema = z.object({
  overallScore: z.number().min(1).max(5),
  summary: z.string().trim().min(1).max(2000),
  content: z.object({
    summary: z.string().trim().min(1).max(1500),
    items: z
      .array(
        z.object({
          questionId: z.string().trim().min(1).max(10),
          score: z.number().min(1).max(5),
          correct: z.array(z.string().trim().min(1).max(500)).max(5),
          incorrect: z.array(z.string().trim().min(1).max(600)).max(5),
          missing: z.array(z.string().trim().min(1).max(500)).max(5),
        }),
      )
      .max(15),
  }),
  tone: z.object({
    summary: z.string().trim().min(1).max(1500),
    traits: z.array(z.string().trim().min(1).max(60)).max(6),
    suggestions: z.array(z.string().trim().min(1).max(400)).max(5),
  }),
  priorities: z.array(z.string().trim().min(1).max(400)).max(5),
});

export interface ReportContext {
  language: string;
  job: Pick<InterviewPromptJob, 'title' | 'company' | 'descriptionText'>;
  questions: InterviewQuestion[];
  transcript: InterviewTurn[];
  spoken: boolean;
  wordsPerMinute: number | null;
}

export function buildReportPrompt(settings: Settings, ctx: ReportContext): { system: string; user: string } {
  const lang = INTERVIEW_LANGUAGES[ctx.language] ?? ctx.language;
  return {
    system: [
      `You are an experienced interviewer. You assess a candidate after a mock job interview held in ${lang}.`,
      ctx.spoken
        ? 'The candidate spoke and the speech was transcribed automatically, with mistakes: words may be wrong, missing or garbled. Read each answer for its overall meaning and do not treat odd words as things the candidate said. You only have the words, not the audio: you cannot judge pronunciation or intonation, so do not comment on them.'
        : 'The candidate wrote the answers.',
      'Respond ONLY with a JSON object of this shape:',
      '{"overallScore": 1-5, "summary": string, "content": {"summary": string, "items": [{"questionId": string, "score": 1-5, "correct": string[], "incorrect": string[], "missing": string[]}]}, "tone": {"summary": string, "traits": string[], "suggestions": string[]}, "priorities": string[]}',
      'Write every explanation in Italian.',
      '- Do NOT assess the language itself: no language level, no remarks on vocabulary, word choice, grammar, spelling or phrasing mistakes, anywhere in the report (summary, tone and priorities included). The transcript is not a reliable record of the exact words.',
      '- content: one item per planned question (use its id, e.g. "q1"), covering the answer and the counter-questions on it. Judge it as a human interviewer would: whether the reasoning makes sense and shows a sound basic understanding, not whether precise terms, tool names or numbers were used, nor whether every aspect was covered. "correct": what was right in the reasoning or in the facts. "incorrect": reasoning that does not hold or basic concepts that were misunderstood, each with the correct idea in plain words; do not list missing jargon or imprecise wording here. "missing": only basic considerations that any competent person in this role would be expected to raise, at most two per question; never specialised details that people look up when needed. Needing a small hint from the interviewer is normal and must not lower the score when the candidate then reasons well. Judge behavioral answers on substance and structure (situation, task, action, result). Skip questions the candidate never reached.',
      '- tone: how the candidate comes across: confidence or hesitation, hedging, professionalism, clarity, concision or rambling, enthusiasm, how questions and challenges were handled. Use the speaking pace if given (about 120-160 words per minute is a natural pace). "traits": a few short adjectives.',
      '- priorities: the three to five most useful things to work on before a real interview, most important first.',
      '- overallScore: 1 = far from ready, 3 = acceptable, 5 = excellent for the seniority of this role. A candidate who reasons sensibly and knows the basics is at least a 3, even without specialised vocabulary.',
    ].join('\n'),
    user: [
      '## Candidate profile',
      candidate(settings),
      '',
      `## Job posting: ${ctx.job.title} at ${ctx.job.company}`,
      clip(ctx.job.descriptionText, 4000),
      '',
      '## Planned questions',
      ...ctx.questions.map((q) => `${q.id} [${q.kind}] ${q.text}`),
      '',
      ...(ctx.wordsPerMinute ? [`## Speaking pace\nAbout ${ctx.wordsPerMinute} words per minute.`, ''] : []),
      '## Interview transcript',
      ...ctx.transcript.map(
        (t) =>
          `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}${t.questionId ? ` (${t.questionId})` : ''}: ${t.text}`,
      ),
    ].join('\n'),
  };
}
