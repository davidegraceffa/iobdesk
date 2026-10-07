import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { extractTechStack, flattenTechStack } from '@jobagg/shared';
import type {
  InterviewAnswerDto,
  InterviewBrief,
  InterviewFeedback,
  InterviewMode,
  InterviewOptions,
  InterviewQuestion,
  InterviewReport,
  InterviewSessionDto,
  InterviewSessionSummary,
  InterviewSuggestionDto,
  InterviewTurn,
  JobSnapshot,
  TechStack,
} from '@jobagg/shared';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { partialJsonString } from '../llm/partial-json';
import { htmlToText, safeLanguage } from '../pipeline/normalize';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFeedbackPrompt,
  BEHAVIORAL_THEMES,
  buildQuestionsPrompt,
  buildReportPrompt,
  buildTurnPrompt,
  MAX_CLARIFICATIONS,
  MAX_FOLLOW_UPS,
  MAX_HINTS,
  followUpBudget,
  openingLine,
  reportSchema,
  turnSchema,
  type TurnAction,
  feedbackSchema,
  INTERVIEW_LANGUAGES,
  pickThemes,
  questionMix,
  questionsSchema,
  TECHNICAL_THEMES,
} from './prompts';
import { SpeechToTextService } from './speech-to-text.service';

const WITH_ANSWERS = { answers: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.InterviewSessionInclude;
type SessionRow = Prisma.InterviewSessionGetPayload<{ include: typeof WITH_ANSWERS }>;
type AnswerRow = SessionRow['answers'][number];

export interface CreateInterviewInput {
  /** ISO 639-1, oppure 'auto' per rilevarla dalla descrizione */
  language: string;
  questionCount: number;
  /** conversazione a voce con contro-domande, oppure una risposta per domanda (default) */
  mode?: InterviewMode;
  consentExternal?: boolean;
  /** descrizione incollata dall'utente quando l'annuncio non ce l'ha */
  description?: string;
}

export type InterviewTargetRef = { kind: 'job' | 'application'; id: string };

interface ResolvedTarget {
  jobId: string | null;
  applicationId: string | null;
  title: string;
  company: string;
  descriptionText: string;
  language: string | null;
}

/** Sotto questa lunghezza la descrizione non basta per domande pertinenti: va incollata. */
export const MIN_DESCRIPTION_CHARS = 150;

export interface AnswerInput {
  transcript: string;
  inputMode: 'audio' | 'text';
  durationSec?: number;
}

const PAYLOAD = [
  'Titolo, azienda, stack e testo dell’annuncio',
  'Titolo e sommario del tuo profilo, keyword e competenze aggiuntive',
  'Il testo delle tue risposte (l’audio viene trascritto in locale e non lascia il computer)',
];

/**
 * Colloqui simulati: domande tecniche e comportamentali generate dall'LLM per un annuncio, nella sua lingua;
 * ogni risposta (trascritta dall'audio o scritta) riceve una valutazione con suggerimenti e una versione migliorata.
 * Generazione e valutazione girano in background: il client segue lo stato rileggendo la sessione.
 */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  /** colloqui con una replica dell'intervistatore in corso */
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly stt: SpeechToTextService,
  ) {}

  // ── DTO ─────────────────────────────────────────────────────────────────────────

  private answerDto(row: AnswerRow): InterviewAnswerDto {
    return {
      questionId: row.questionId,
      transcript: row.transcript,
      inputMode: row.inputMode === 'text' ? 'text' : 'audio',
      durationSec: row.durationSec,
      status: row.status as InterviewAnswerDto['status'],
      feedback: (row.feedback as unknown as InterviewFeedback | null) ?? null,
      error: row.error,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private summary(row: SessionRow): InterviewSessionSummary {
    const scores = row.answers
      .map((a) => (a.feedback as unknown as InterviewFeedback | null)?.score)
      .filter((s): s is number => typeof s === 'number');
    const report = row.report as unknown as InterviewReport | null;
    const transcript = row.transcript as unknown as InterviewTurn[];
    return {
      id: row.id,
      jobId: row.jobId,
      applicationId: row.applicationId,
      attempt: row.attempt,
      jobTitle: row.jobTitle,
      company: row.company,
      language: row.language,
      status: row.status as InterviewSessionSummary['status'],
      questionCount: row.questionCount,
      mode: row.mode === 'live' ? 'live' : 'turns',
      finishedAt: row.finishedAt?.toISOString() ?? null,
      overallScore: report?.overallScore ?? null,
      answeredCount:
        row.mode === 'live'
          ? new Set(transcript.filter((t) => t.role === 'candidate' && t.questionId).map((t) => t.questionId)).size
          : row.answers.length,
      averageScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private dto(row: SessionRow): InterviewSessionDto {
    return {
      ...this.summary(row),
      transcript: row.transcript as unknown as InterviewTurn[],
      report: (row.report as unknown as InterviewReport | null) ?? null,
      reportStatus: (row.reportStatus as InterviewSessionDto['reportStatus']) ?? null,
      reportError: row.reportError,
      error: row.error,
      provider: row.provider,
      model: row.model,
      questions: row.questions as unknown as InterviewQuestion[],
      brief: (row.brief as unknown as InterviewBrief | null) ?? null,
      answers: row.answers.map((a) => this.answerDto(a)),
    };
  }

  private async load(id: string): Promise<SessionRow> {
    const row = await this.prisma.interviewSession.findUnique({ where: { id }, include: WITH_ANSWERS });
    if (!row) throw new NotFoundException('Colloquio non trovato');
    return row;
  }

  // ── creazione ───────────────────────────────────────────────────────────────────

  /** Annuncio o candidatura su cui fare il colloquio, con il testo dell'offerta se c'è. */
  private async resolveTarget(target: InterviewTargetRef): Promise<ResolvedTarget> {
    if (target.kind === 'job') {
      const job = await this.prisma.job.findUnique({ where: { id: target.id } });
      if (!job) throw new NotFoundException('Annuncio non trovato');
      return {
        jobId: job.id,
        applicationId: null,
        title: job.title,
        company: job.company,
        descriptionText: job.descriptionText,
        language: job.language,
      };
    }
    const application = await this.prisma.application.findUnique({ where: { id: target.id }, include: { job: true } });
    if (!application) throw new NotFoundException('Candidatura non trovata');
    const snapshot = application.snapshot as unknown as JobSnapshot;
    // annuncio ancora presente: vale il suo testo; altrimenti la copia salvata con la candidatura
    const fromJob = application.job?.descriptionText ?? '';
    const fromSnapshot = htmlToText(snapshot.descriptionOriginal ?? '');
    const descriptionText = fromJob.trim().length >= fromSnapshot.trim().length ? fromJob : fromSnapshot;
    return {
      jobId: application.jobId,
      applicationId: application.id,
      title: snapshot.title,
      company: snapshot.company,
      descriptionText,
      language: application.job?.language ?? safeLanguage(descriptionText),
    };
  }

  private targetWhere(target: Pick<ResolvedTarget, 'jobId' | 'applicationId'>): Prisma.InterviewSessionWhereInput {
    const or: Prisma.InterviewSessionWhereInput[] = [];
    if (target.jobId) or.push({ jobId: target.jobId });
    if (target.applicationId) or.push({ applicationId: target.applicationId });
    return or.length ? { OR: or } : { id: '__none__' };
  }

  async options(target: InterviewTargetRef): Promise<InterviewOptions> {
    const resolved = await this.resolveTarget(target);
    const status = this.llm.status(await this.settings.get());
    // il consenso mancante non rende l'azione indisponibile: viene chiesto nel dialog
    const onlyConsentMissing = !status.ready && status.enabled && status.external && !status.consentGiven;
    const descriptionAvailable = resolved.descriptionText.trim().length >= MIN_DESCRIPTION_CHARS;
    return {
      available: status.ready || onlyConsentMissing,
      reason: status.ready || onlyConsentMissing ? null : status.notReadyReason,
      title: resolved.title,
      company: resolved.company,
      descriptionAvailable,
      previousAttempts: await this.prisma.interviewSession.count({ where: this.targetWhere(resolved) }),
      detectedLanguage: resolved.language,
      suggestedLanguage:
        resolved.language && INTERVIEW_LANGUAGES[resolved.language]
          ? resolved.language
          : descriptionAvailable
            ? 'en'
            : 'auto',
      provider: status.provider,
      model: status.model,
      external: status.external,
      consentGiven: status.consentGiven,
      payloadSummary: PAYLOAD,
      speechToText: await this.stt.available(),
    };
  }

  /** LLM pronto, chiedendo e salvando il consenso per i provider esterni (come per i CV). */
  private async ensureLlm(consentExternal?: boolean): Promise<{ provider: string; model: string }> {
    let settings = await this.settings.get();
    let status = this.llm.status(settings);
    if (status.enabled && status.external && !status.consentGiven) {
      if (!consentExternal) {
        throw new ConflictException({
          message: `Annuncio e risposte verranno inviati a un provider esterno (${status.provider}): serve il tuo consenso esplicito`,
          code: 'consent_required',
        });
      }
      const next = structuredClone(settings);
      next.scoring.llm.external_consent = true;
      settings = (await this.settings.save(next, 'consent')).settings;
      status = this.llm.status(settings);
    }
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');
    return { provider: status.provider, model: status.model };
  }

  private async startSession(
    target: Pick<ResolvedTarget, 'jobId' | 'applicationId' | 'title' | 'company'>,
    descriptionText: string,
    language: string,
    questionCount: number,
    llm: { provider: string; model: string },
    mode: InterviewMode,
  ): Promise<InterviewSessionDto> {
    const attempt = (await this.prisma.interviewSession.count({ where: this.targetWhere(target) })) + 1;
    const session = await this.prisma.interviewSession.create({
      data: {
        jobId: target.jobId,
        applicationId: target.applicationId,
        attempt,
        jobTitle: target.title,
        company: target.company,
        descriptionText,
        language,
        questionCount,
        mode,
        provider: llm.provider,
        model: llm.model,
      },
      include: WITH_ANSWERS,
    });
    void this.generate(session.id);
    return this.dto(session);
  }

  async create(target: InterviewTargetRef, input: CreateInterviewInput): Promise<InterviewSessionDto> {
    const resolved = await this.resolveTarget(target);
    const pasted = input.description?.trim() ?? '';
    const descriptionText = pasted || resolved.descriptionText.trim();
    if (descriptionText.length < MIN_DESCRIPTION_CHARS) {
      throw new BadRequestException({
        message: 'Manca la descrizione dell’annuncio: incollala per generare domande pertinenti',
        code: 'description_required',
      });
    }
    let language = input.language;
    if (language === 'auto') {
      const detected = safeLanguage(descriptionText);
      language = detected && INTERVIEW_LANGUAGES[detected] ? detected : 'en';
    }
    if (!INTERVIEW_LANGUAGES[language]) throw new BadRequestException('Lingua non supportata');
    const llm = await this.ensureLlm(input.consentExternal);

    // la descrizione incollata resta con la candidatura: ai tentativi successivi non va reincollata
    if (pasted && resolved.applicationId) {
      const application = await this.prisma.application.findUniqueOrThrow({ where: { id: resolved.applicationId } });
      const snapshot = application.snapshot as unknown as JobSnapshot;
      if (!htmlToText(snapshot.descriptionOriginal ?? '').trim()) {
        await this.prisma.application.update({
          where: { id: application.id },
          data: { snapshot: { ...snapshot, descriptionOriginal: pasted } as unknown as Prisma.InputJsonValue },
        });
      }
    }
    return this.startSession(resolved, descriptionText, language, input.questionCount, llm, input.mode ?? 'turns');
  }

  /** Nuovo tentativo sullo stesso annuncio o candidatura: stesse impostazioni, domande nuove. */
  async again(id: string, consentExternal?: boolean): Promise<InterviewSessionDto> {
    const previous = await this.load(id);
    const llm = await this.ensureLlm(consentExternal);
    return this.startSession(
      {
        jobId: previous.jobId,
        applicationId: previous.applicationId,
        title: previous.jobTitle,
        company: previous.company,
      },
      previous.descriptionText,
      previous.language,
      previous.questionCount,
      llm,
      previous.mode === 'live' ? 'live' : 'turns',
    );
  }

  /** Genera le domande; in caso di errore la sessione resta visibile con il motivo. */
  async generate(id: string, random: () => number = Math.random): Promise<void> {
    try {
      const session = await this.load(id);
      const job = session.jobId ? await this.prisma.job.findUnique({ where: { id: session.jobId } }) : null;
      const descriptionText = session.descriptionText || job?.descriptionText || '';
      if (!descriptionText.trim()) throw new Error('Manca la descrizione dell’annuncio');
      const settings = await this.settings.get();
      const { technical, behavioral } = questionMix(session.questionCount);

      // domande dei tentativi precedenti sullo stesso annuncio o candidatura: da non ripetere
      const earlier = await this.prisma.interviewSession.findMany({
        where: { AND: [this.targetWhere(session), { id: { not: id } }, { status: 'ready' }] },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { questions: true },
      });
      const avoid = earlier
        .flatMap((s) => (s.questions as unknown as InterviewQuestion[]).map((q) => q.text))
        .slice(0, 36);

      const result = await this.llm.completeJson(settings, questionsSchema(session.questionCount), {
        task: 'interview_questions',
        ...buildQuestionsPrompt(
          settings,
          {
            title: session.jobTitle,
            company: session.company,
            descriptionText,
            seniority: job?.seniority ?? 'unknown',
            techStack: job
              ? (job.techStack as unknown as TechStack)
              : extractTechStack({ title: session.jobTitle, description: descriptionText }),
          },
          session.language,
          session.questionCount,
          {
            attempt: session.attempt,
            technicalThemes: pickThemes(TECHNICAL_THEMES, Math.max(2, technical), random),
            behavioralThemes: pickThemes(BEHAVIORAL_THEMES, Math.max(2, behavioral), random),
            avoid,
          },
        ),
        maxTokens: 8000,
        mockContext: {
          count: session.questionCount,
          language: session.language,
          title: session.jobTitle,
          attempt: session.attempt,
        },
      });
      const questions: InterviewQuestion[] = result.questions.slice(0, session.questionCount).map((q, i) => ({
        id: `q${i + 1}`,
        kind: q.kind,
        text: q.question,
        focus: q.focus,
        hints: q.hints.slice(0, 2),
      }));
      await this.prisma.interviewSession.update({
        where: { id },
        data: {
          status: 'ready',
          error: null,
          questionCount: questions.length,
          questions: questions as unknown as Prisma.InputJsonValue,
          brief: (result.brief as unknown as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Domande del colloquio ${id} non generate: ${message}`);
      await this.prisma.interviewSession
        .update({ where: { id }, data: { status: 'failed', error: message } })
        .catch(() => undefined);
    }
  }

  /** Riprova la generazione di una sessione fallita. */
  async retry(id: string): Promise<InterviewSessionDto> {
    const session = await this.load(id);
    if (session.status !== 'failed') throw new ConflictException('Le domande sono già state generate');
    if (!this.llm.status(await this.settings.get()).ready) {
      throw new ConflictException(this.llm.status(await this.settings.get()).notReadyReason ?? 'LLM non disponibile');
    }
    const updated = await this.prisma.interviewSession.update({
      where: { id },
      data: { status: 'generating', error: null },
      include: WITH_ANSWERS,
    });
    void this.generate(id);
    return this.dto(updated);
  }

  // ── lettura ─────────────────────────────────────────────────────────────────────

  async get(id: string): Promise<InterviewSessionDto> {
    return this.dto(await this.load(id));
  }

  async list(filter: { jobId?: string; applicationId?: string } = {}): Promise<InterviewSessionSummary[]> {
    const rows = await this.prisma.interviewSession.findMany({
      where:
        filter.jobId || filter.applicationId
          ? this.targetWhere({ jobId: filter.jobId ?? null, applicationId: filter.applicationId ?? null })
          : {},
      include: WITH_ANSWERS,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.summary(r));
  }

  /**
   * Proposta per la homepage: una candidatura passata scelta a caso, con quanto serve per decidere se
   * esercitarsi. Si pesca solo tra quelle inviate che hanno già il testo dell'annuncio (dall'annuncio
   * collegato o dalla copia salvata), così il colloquio parte senza dover incollare nulla.
   * `exclude` evita di riproporre la stessa quando se ne chiede un'altra.
   */
  async suggestion(exclude?: string): Promise<InterviewSuggestionDto | null> {
    const sent = await this.prisma.application.findMany({
      where: { currentStatus: { not: 'skipped' } },
      select: { id: true, snapshot: true, job: { select: { descriptionText: true } } },
    });
    const all = sent.filter((a) => {
      const snapshot = a.snapshot as unknown as JobSnapshot;
      const length = Math.max(
        (a.job?.descriptionText ?? '').trim().length,
        htmlToText(snapshot.descriptionOriginal ?? '').trim().length,
      );
      return length >= MIN_DESCRIPTION_CHARS;
    });
    const pool = all.length > 1 && exclude ? all.filter((a) => a.id !== exclude) : all;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!picked) return null;
    const application = await this.prisma.application.findUnique({ where: { id: picked.id } });
    if (!application) return null;
    const resolved = await this.resolveTarget({ kind: 'application', id: picked.id });
    const snapshot = application.snapshot as unknown as JobSnapshot;
    const sessions = await this.prisma.interviewSession.findMany({
      where: this.targetWhere(resolved),
      select: { createdAt: true, report: true },
      orderBy: { createdAt: 'desc' },
    });
    const lastReport = sessions
      .map((s) => s.report as unknown as InterviewReport | null)
      .find((report) => typeof report?.overallScore === 'number');
    return {
      applicationId: application.id,
      jobId: application.jobId,
      title: resolved.title,
      company: resolved.company,
      location: snapshot.location ?? '',
      appliedAt: application.appliedAt.toISOString(),
      currentStatus: application.currentStatus as InterviewSuggestionDto['currentStatus'],
      techStack: flattenTechStack(snapshot.techStack).slice(0, 8),
      language: resolved.language,
      previousAttempts: sessions.length,
      lastInterviewAt: sessions[0]?.createdAt.toISOString() ?? null,
      lastOverallScore: lastReport?.overallScore ?? null,
      alternatives: all.length - 1,
    };
  }

  async remove(id: string): Promise<void> {
    await this.load(id);
    await this.prisma.interviewSession.delete({ where: { id } });
  }

  // ── risposte ────────────────────────────────────────────────────────────────────

  async transcribe(
    audio: Buffer | undefined,
    mimeType: string,
    language: string,
    sessionId?: string,
  ): Promise<{ text: string }> {
    if (!audio || audio.length === 0) throw new BadRequestException('Registrazione vuota');
    if (!INTERVIEW_LANGUAGES[language]) throw new BadRequestException('Lingua non supportata');
    // titolo e tecnologie dell'annuncio come suggerimento: "NestJS" o "PostgreSQL" vengono scritti correttamente
    let hint = '';
    if (sessionId) {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
        select: { jobTitle: true, descriptionText: true },
      });
      if (session) {
        const tech = flattenTechStack(
          extractTechStack({ title: session.jobTitle, description: session.descriptionText }),
        );
        hint = [session.jobTitle, ...tech].join(', ').slice(0, 300);
      }
    }
    return { text: await this.stt.transcribe(audio, mimeType || 'audio/webm', language, hint) };
  }

  /** Salva (o sostituisce) la risposta a una domanda e ne avvia la valutazione. */
  async answer(id: string, questionId: string, input: AnswerInput): Promise<InterviewSessionDto> {
    const session = await this.load(id);
    if (session.status !== 'ready') throw new ConflictException('Le domande non sono ancora pronte');
    const questions = session.questions as unknown as InterviewQuestion[];
    if (!questions.some((q) => q.id === questionId)) throw new NotFoundException('Domanda non trovata');
    const transcript = input.transcript.trim();
    if (!transcript) throw new BadRequestException('La risposta è vuota');
    const data = {
      transcript,
      inputMode: input.inputMode,
      durationSec: input.durationSec ?? null,
      status: 'pending',
      feedback: Prisma.DbNull,
      error: null,
    };
    const answer = await this.prisma.interviewAnswer.upsert({
      where: { sessionId_questionId: { sessionId: id, questionId } },
      create: { sessionId: id, questionId, ...data },
      update: data,
    });
    void this.evaluate(answer.id);
    return this.get(id);
  }

  /** Valuta una risposta; un errore resta visibile sulla risposta e si può riprovare reinviandola. */
  async evaluate(answerId: string): Promise<void> {
    try {
      const answer = await this.prisma.interviewAnswer.findUniqueOrThrow({
        where: { id: answerId },
        include: { session: true },
      });
      const { session } = answer;
      const question = (session.questions as unknown as InterviewQuestion[]).find((q) => q.id === answer.questionId);
      if (!question) throw new Error('Domanda non trovata');
      const job =
        session.descriptionText || !session.jobId
          ? null
          : await this.prisma.job.findUnique({ where: { id: session.jobId } });
      const settings = await this.settings.get();
      const result = await this.llm.completeJson(settings, feedbackSchema, {
        task: 'interview_feedback',
        ...buildFeedbackPrompt(
          settings,
          {
            title: session.jobTitle,
            company: session.company,
            descriptionText: session.descriptionText || job?.descriptionText || '',
          },
          session.language,
          question,
          answer.transcript,
          answer.inputMode === 'text' ? 'text' : 'audio',
        ),
        maxTokens: 6000,
        mockContext: { transcript: answer.transcript, kind: question.kind },
      });
      const feedback: InterviewFeedback = { ...result, score: Math.round(result.score) };
      // se nel frattempo la risposta è stata sostituita, questa valutazione non vale più
      await this.prisma.interviewAnswer.updateMany({
        where: { id: answerId, transcript: answer.transcript },
        data: { status: 'ready', feedback: feedback as unknown as Prisma.InputJsonValue, error: null },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Valutazione della risposta ${answerId} non riuscita: ${message}`);
      await this.prisma.interviewAnswer
        .update({ where: { id: answerId }, data: { status: 'failed', error: message } })
        .catch(() => undefined);
    }
  }

  /** All'avvio: generazioni e valutazioni interrotte da un riavvio vengono segnate come fallite. */
  async closeInterrupted(): Promise<void> {
    const reason = 'Interrotta dal riavvio dell’applicazione: riprova';
    await this.prisma.interviewSession.updateMany({
      where: { status: 'generating' },
      data: { status: 'failed', error: reason },
    });
    await this.prisma.interviewAnswer.updateMany({
      where: { status: 'pending' },
      data: { status: 'failed', error: reason },
    });
    await this.prisma.interviewSession.updateMany({
      where: { reportStatus: 'pending' },
      data: { reportStatus: 'failed', reportError: reason },
    });
  }

  // ── conversazione a voce ────────────────────────────────────────────────────────

  private turn(partial: Omit<InterviewTurn, 'id' | 'at'>, transcript: InterviewTurn[]): InterviewTurn {
    return { ...partial, id: `t${transcript.length + 1}`, at: new Date().toISOString() };
  }

  private async liveSession(id: string): Promise<SessionRow> {
    const session = await this.load(id);
    if (session.mode !== 'live') throw new ConflictException('Questo colloquio non è una conversazione');
    if (session.status !== 'ready') throw new ConflictException('Le domande non sono ancora pronte');
    return session;
  }

  /** Apre la conversazione: saluto e prima domanda (senza attendere l'LLM). Idempotente. */
  async liveStart(id: string): Promise<InterviewSessionDto> {
    const session = await this.liveSession(id);
    const transcript = session.transcript as unknown as InterviewTurn[];
    const questions = session.questions as unknown as InterviewQuestion[];
    const first = questions[0];
    if (transcript.length > 0 || !first) return this.dto(session);
    const opening = this.turn(
      {
        role: 'interviewer',
        kind: 'question',
        questionId: first.id,
        text: openingLine(session.language, first),
        durationSec: null,
      },
      transcript,
    );
    const updated = await this.prisma.interviewSession.update({
      where: { id },
      data: { transcript: [opening] as unknown as Prisma.InputJsonValue },
      include: WITH_ANSWERS,
    });
    return this.dto(updated);
  }

  /**
   * Una battuta del candidato e la replica dell'intervistatore: contro-domanda, chiarimento, piccolo aiuto, domanda
   * successiva oppure chiusura. Lo stato (domanda corrente, contro-domande già fatte) si ricava dalla
   * trascrizione; la replica usa il modello rapido per arrivare in un paio di secondi.
   */
  async liveTurn(
    id: string,
    input: { text: string; durationSec?: number },
    /** riceve la battuta dell'intervistatore a pezzi, mentre il modello la scrive */
    onSay?: (delta: string) => void,
  ): Promise<InterviewSessionDto> {
    if (this.busy.has(id)) throw new ConflictException('Sto ancora rispondendo alla battuta precedente');
    this.busy.add(id);
    try {
      const session = await this.liveSession(id);
      if (session.finishedAt) throw new ConflictException('Il colloquio è già concluso');
      const text = input.text.trim();
      if (!text) throw new BadRequestException('La risposta è vuota');
      const questions = session.questions as unknown as InterviewQuestion[];
      const transcript = [...(session.transcript as unknown as InterviewTurn[])];
      const lastQuestionId = [...transcript].reverse().find((t) => t.role === 'interviewer')?.questionId;
      const index = questions.findIndex((q) => q.id === lastQuestionId);
      const current = questions[index];
      if (!current) throw new ConflictException('La conversazione non è ancora iniziata');
      const next = questions[index + 1] ?? null;

      transcript.push(
        this.turn(
          { role: 'candidate', kind: 'answer', questionId: current.id, text, durationSec: input.durationSec ?? null },
          transcript,
        ),
      );
      const asked = (kind: InterviewTurn['kind']) =>
        transcript.filter((t) => t.role === 'interviewer' && t.questionId === current.id && t.kind === kind).length;
      const followUps = transcript.filter((t) => t.role === 'interviewer' && t.kind === 'follow_up').length;
      // "next" per primo: è la scelta normale, la contro-domanda è l'eccezione
      const allowed: TurnAction[] = ['next'];
      if (asked('follow_up') < MAX_FOLLOW_UPS && followUps < followUpBudget(questions.length)) {
        allowed.push('follow_up');
      }
      if (asked('clarify') < MAX_CLARIFICATIONS) allowed.push('clarify');
      if (asked('hint') < MAX_HINTS) allowed.push('hint');

      const settings = await this.settings.get();
      let said = 0;
      const onText = onSay
        ? (accumulated: string) => {
            const say = partialJsonString(accumulated, 'say');
            if (say.length > said) {
              onSay(say.slice(said));
              said = say.length;
            }
          }
        : undefined;
      const request = {
        task: 'interview_turn' as const,
        fast: true,
        maxTokens: 1000,
        ...buildTurnPrompt({
          language: session.language,
          job: { title: session.jobTitle, company: session.company, descriptionText: session.descriptionText },
          questions,
          current,
          next,
          allowed,
          transcript,
        }),
        mockContext: {
          allowed,
          next: next?.text ?? null,
          words: text.split(/\s+/).length,
          stuck: /\bi don.?t know\b|\bnon lo so\b/i.test(text),
        },
      };
      const reply = await this.llm.completeJson(settings, turnSchema(allowed), request, onText);

      const closing = reply.action === 'next' && !next;
      transcript.push(
        this.turn(
          {
            role: 'interviewer',
            kind: closing ? 'closing' : reply.action === 'next' ? 'question' : reply.action,
            questionId: reply.action === 'next' ? (next?.id ?? null) : current.id,
            text: reply.say,
            durationSec: null,
          },
          transcript,
        ),
      );
      await this.prisma.interviewSession.update({
        where: { id },
        data: {
          transcript: transcript as unknown as Prisma.InputJsonValue,
          ...(closing ? { finishedAt: new Date(), reportStatus: 'pending', reportError: null } : {}),
        },
      });
      if (closing) void this.generateReport(id);
      return this.get(id);
    } finally {
      this.busy.delete(id);
    }
  }

  /** Chiude il colloquio (anche a metà) e avvia la valutazione finale. */
  async finish(id: string): Promise<InterviewSessionDto> {
    const session = await this.load(id);
    if (session.status !== 'ready') throw new ConflictException('Le domande non sono ancora pronte');
    return this.requestReport(id, session.finishedAt ?? new Date());
  }

  private async requestReport(id: string, finishedAt: Date): Promise<InterviewSessionDto> {
    const session = await this.load(id);
    if (this.reportTranscript(session).filter((t) => t.role === 'candidate').length === 0) {
      throw new BadRequestException('Non c’è ancora nessuna risposta da valutare');
    }
    if (!this.llm.status(await this.settings.get()).ready) {
      throw new ConflictException(this.llm.status(await this.settings.get()).notReadyReason ?? 'LLM non disponibile');
    }
    await this.prisma.interviewSession.update({
      where: { id },
      data: { finishedAt, reportStatus: 'pending', reportError: null },
    });
    void this.generateReport(id);
    return this.get(id);
  }

  /** Battute da valutare: la conversazione, oppure domande e risposte del colloquio a turni. */
  private reportTranscript(session: SessionRow): InterviewTurn[] {
    if (session.mode === 'live') return session.transcript as unknown as InterviewTurn[];
    const questions = session.questions as unknown as InterviewQuestion[];
    const turns: InterviewTurn[] = [];
    for (const question of questions) {
      const answer = session.answers.find((a) => a.questionId === question.id);
      if (!answer) continue;
      turns.push(
        this.turn(
          { role: 'interviewer', kind: 'question', questionId: question.id, text: question.text, durationSec: null },
          turns,
        ),
        this.turn(
          {
            role: 'candidate',
            kind: 'answer',
            questionId: question.id,
            text: answer.transcript,
            durationSec: answer.inputMode === 'audio' ? answer.durationSec : null,
          },
          turns,
        ),
      );
    }
    return turns;
  }

  /** Valutazione finale: correttezza dei contenuti e tono. Usa il modello principale. */
  async generateReport(id: string): Promise<void> {
    try {
      const session = await this.load(id);
      const transcript = this.reportTranscript(session);
      const answers = transcript.filter((t) => t.role === 'candidate');
      const words = answers.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
      // il ritmo si calcola solo sulle risposte a voce di cui si conosce la durata
      const timed = answers.filter((t) => (t.durationSec ?? 0) > 0);
      const speakingSeconds = timed.reduce((n, t) => n + (t.durationSec ?? 0), 0);
      const timedWords = timed.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
      const wordsPerMinute = speakingSeconds >= 20 ? Math.round((timedWords / speakingSeconds) * 60) : null;

      const settings = await this.settings.get();
      const result = await this.llm.completeJson(settings, reportSchema, {
        task: 'interview_report',
        maxTokens: 12000,
        ...buildReportPrompt(settings, {
          language: session.language,
          job: { title: session.jobTitle, company: session.company, descriptionText: session.descriptionText },
          questions: session.questions as unknown as InterviewQuestion[],
          transcript,
          spoken: timed.length > 0,
          wordsPerMinute,
        }),
        mockContext: { words },
      });
      const report: InterviewReport = {
        ...result,
        overallScore: Math.round(result.overallScore),
        content: { ...result.content, items: result.content.items.map((i) => ({ ...i, score: Math.round(i.score) })) },
        delivery: { answers: answers.length, words, speakingSeconds, wordsPerMinute },
      };
      await this.prisma.interviewSession.update({
        where: { id },
        data: { report: report as unknown as Prisma.InputJsonValue, reportStatus: 'ready', reportError: null },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Valutazione finale del colloquio ${id} non riuscita: ${message}`);
      await this.prisma.interviewSession
        .update({ where: { id }, data: { reportStatus: 'failed', reportError: message } })
        .catch(() => undefined);
    }
  }
}
