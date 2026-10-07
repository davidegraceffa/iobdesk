import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  cvAtsSchema,
  cvReviewSchema,
  flattenTechStack,
  parseExtraSkills,
  type AppliedCvEdit,
  type BaseCvDto,
  type CvEdit,
  type CvAtsReport,
  type CvEdits,
  type CvReviewApplyResult,
  type StoredCvReviewSuggestion,
  type CvReviewDto,
  type CvReviewOverview,
  type CvReviewSuggestion,
  type CvReviewSuggestionStatus,
  type CvStructure,
  type Settings,
  type TechStack,
} from '@jobagg/shared';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { allowedTechnologies, validateEdits } from './anti-invention';
import { applyEditsToDocx } from './apply-edits';
import { BaseCvService, toBaseCvDto } from './base-cv.service';
import { CvStorageService } from './cv-storage.service';
import { atsFacts, buildCvAtsPrompt, buildCvReviewPrompt } from './prompts';

const DAY_MS = 86_400_000;
/** ogni quanto si controlla se un CV è da rivedere */
const TICK_MS = 60 * 60_000;
/** annunci compatibili degli ultimi giorni da cui ricavare le tecnologie più richieste */
const MARKET_DAYS = 60;
const MARKET_MAX_JOBS = 1500;
/** una tecnologia entra tra quelle "richieste spesso" se compare almeno in questi annunci */
const MARKET_MIN_JOBS = 3;

/** Una voce delle aggiunte su una riga sola: virgole e a capo separerebbero le voci quando l'elenco viene riletto. */
function singleLine(text: string): string {
  return text
    .replace(/[\n,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chiave di confronto tra un requisito e una voce delle aggiunte. */
const skillKey = (text: string) => singleLine(text).toLowerCase();

const KIND_OF_EDIT: Record<CvEdit['op'], CvReviewSuggestion['kind']> = {
  replace: 'rewrite',
  remove: 'remove',
  insert_after: 'add',
  reorder: 'structure',
};

/** Prima e dopo di una modifica, per mostrarla all'utente. */
function describeEdit(
  edit: CvEdit | null,
  structure: CvStructure,
): Pick<CvReviewSuggestion, 'sectionTitle' | 'originalText' | 'proposedText'> {
  if (!edit) return { sectionTitle: null, originalText: null, proposedText: null };
  const text = (id: string) => structure.paragraphs.find((p) => p.id === id)?.text ?? '';
  const sectionOf = (id: string) => {
    const paragraph = structure.paragraphs.find((p) => p.id === id);
    return structure.sections.find((s) => s.id === paragraph?.sectionId)?.title ?? null;
  };
  if (edit.op === 'replace') {
    return {
      sectionTitle: sectionOf(edit.paragraphId),
      originalText: text(edit.paragraphId),
      proposedText: edit.newText,
    };
  }
  if (edit.op === 'remove') {
    return { sectionTitle: sectionOf(edit.paragraphId), originalText: text(edit.paragraphId), proposedText: null };
  }
  if (edit.op === 'insert_after') {
    return { sectionTitle: sectionOf(edit.afterParagraphId), originalText: null, proposedText: edit.newText };
  }
  // riordino: l'ordine attuale dei paragrafi coinvolti e quello proposto
  const section = structure.sections.find((s) => s.id === edit.sectionId);
  const current = (section?.paragraphIds ?? []).filter((id) => edit.paragraphIds.includes(id));
  return {
    sectionTitle: section?.title ?? null,
    originalText: current.map(text).join('\n'),
    proposedText: edit.paragraphIds.map(text).join('\n'),
  };
}

const WITH_BASE = { baseCv: true } satisfies Prisma.CvReviewInclude;
type ReviewRow = Prisma.CvReviewGetPayload<{ include: typeof WITH_BASE }>;

/**
 * Sezione "Migliora CV": periodicamente (o su richiesta) l'LLM rilegge ogni CV base e propone cosa
 * migliorare, tenendo conto di ciò che gli annunci compatibili chiedono. Le proposte sono testo da
 * valutare: il DOCX base non viene mai modificato dall'app.
 */
@Injectable()
export class CvReviewService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CvReviewService.name);
  private timer?: NodeJS.Timeout;
  private firstTick?: NodeJS.Timeout;
  private readonly running = new Set<string>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly baseCvs: BaseCvService,
    private readonly storage: CvStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.cliMode) return;
    await this.prisma.cvReview.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', error: 'Controllo interrotto dal riavvio dell’applicazione', finishedAt: new Date() },
    });
    await this.prisma.baseCv.updateMany({
      where: { atsReport: { path: ['status'], equals: 'running' } },
      data: { atsReport: Prisma.DbNull },
    });
    const tick = () => {
      this.runDue().catch((err: Error) => this.logger.error(`Controllo periodico dei CV fallito: ${err.message}`));
    };
    this.timer = setInterval(tick, TICK_MS);
    this.firstTick = setTimeout(tick, 2 * 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTick) clearTimeout(this.firstTick);
  }

  // ── dati di contesto ──────────────────────────────────────────────────────────

  private activeBaseCvs(settings: Settings) {
    return this.prisma.baseCv
      .findMany({ where: { isActive: true, error: null }, orderBy: { language: 'asc' } })
      .then((rows) => rows.filter((r) => (settings.cv.languages as string[]).includes(r.language)));
  }

  /** Tecnologie più richieste negli annunci compatibili recenti che il candidato non dichiara da nessuna parte. */
  private async market(owned: Set<string>): Promise<{ items: CvReviewOverview['market']; jobs: number }> {
    const jobs = await this.prisma.job.findMany({
      where: {
        rejectedReason: null,
        duplicateOfId: null,
        firstSeenAt: { gte: new Date(Date.now() - MARKET_DAYS * DAY_MS) },
      },
      select: { techStack: true },
      orderBy: { firstSeenAt: 'desc' },
      take: MARKET_MAX_JOBS,
    });
    const counts = new Map<string, number>();
    for (const job of jobs) {
      for (const tech of new Set(flattenTechStack(job.techStack as unknown as TechStack))) {
        if (!owned.has(tech)) counts.set(tech, (counts.get(tech) ?? 0) + 1);
      }
    }
    const items = [...counts.entries()]
      .filter(([, count]) => count >= MARKET_MIN_JOBS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, jobs: count }));
    return { items, jobs: jobs.length };
  }

  /** Requisiti che i CV su misura non hanno potuto coprire, dal più frequente. */
  private async gaps(extraSkills: string[]): Promise<CvReviewOverview['gaps']> {
    const cvs = await this.prisma.generatedCv.findMany({
      where: { status: 'ready' },
      select: { gaps: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    // un requisito già scritto tra le aggiunte non va più segnalato
    const known = new Set(extraSkills.map(skillKey));
    const counts = new Map<string, { requirement: string; count: number }>();
    for (const cv of cvs) {
      const seen = new Set<string>();
      for (const gap of (cv.gaps as unknown as CvEdits['gaps']) ?? []) {
        const requirement = gap.requirement?.trim();
        const key = requirement ? skillKey(requirement) : '';
        if (!requirement || !key || seen.has(key) || known.has(key)) continue;
        seen.add(key);
        const entry = counts.get(key) ?? { requirement, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }

  private ownedTechnologies(structures: CvStructure[], extraSkills: string[]): Set<string> {
    const owned = new Set<string>();
    for (const structure of structures) for (const t of allowedTechnologies(structure, extraSkills)) owned.add(t);
    if (structures.length === 0) {
      for (const t of allowedTechnologies(
        { paragraphs: [], sections: [], overrides: {}, candidateName: '' },
        extraSkills,
      ))
        owned.add(t);
    }
    return owned;
  }

  // ── lettura ───────────────────────────────────────────────────────────────────

  private toDto(row: ReviewRow, activeBaseCvId: string | undefined): CvReviewDto {
    return {
      id: row.id,
      baseCvId: row.baseCvId,
      language: row.language,
      trigger: row.trigger === 'manual' ? 'manual' : 'schedule',
      status: row.status as CvReviewDto['status'],
      error: row.error,
      provider: row.provider,
      model: row.model,
      summary: row.summary,
      suggestions: (row.suggestions as unknown as StoredCvReviewSuggestion[]).map(({ edit, ...s }) => ({
        ...s,
        // i controlli fatti prima che le proposte fossero applicabili non hanno la modifica
        applicable: !!edit,
      })),
      createdAt: row.createdAt.toISOString(),
      outdated: !!activeBaseCvId && activeBaseCvId !== row.baseCvId && activeBaseCvId !== row.resultBaseCvId,
      resultBaseCvId: row.resultBaseCvId,
    };
  }

  /** Ultimo controllo per lingua: quello in corso, altrimenti l'ultimo concluso. */
  private async latest(language: string): Promise<ReviewRow | null> {
    return this.prisma.cvReview.findFirst({ where: { language }, include: WITH_BASE, orderBy: { createdAt: 'desc' } });
  }

  async overview(): Promise<CvReviewOverview> {
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    const extraSkills = parseExtraSkills(settings.cv.extra_skills);
    const baseCvs = await this.activeBaseCvs(settings);
    const owned = this.ownedTechnologies(
      baseCvs.map((b) => b.structure as unknown as CvStructure),
      extraSkills,
    );
    const market = await this.market(owned);
    const { enabled, interval_days: intervalDays } = settings.cv.review;
    const languages: CvReviewOverview['languages'] = [];
    for (const baseCv of baseCvs) {
      const review = await this.latest(baseCv.language);
      const lastDone = await this.prisma.cvReview.findFirst({
        where: { language: baseCv.language, status: 'ready' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      languages.push({
        language: baseCv.language,
        baseCv: toBaseCvDto(baseCv),
        review: review ? this.toDto(review, baseCv.id) : null,
        ats: (baseCv.atsReport as unknown as CvAtsReport | null) ?? null,
        nextRunAt:
          enabled && status.ready
            ? new Date(Math.max(Date.now(), (lastDone?.createdAt.getTime() ?? 0) + intervalDays * DAY_MS)).toISOString()
            : null,
      });
    }
    return {
      enabled,
      intervalDays,
      available: status.ready,
      reason: status.ready ? null : status.notReadyReason,
      provider: status.provider,
      model: status.model,
      external: status.external,
      languages,
      extraSkills,
      market: market.items,
      marketJobs: market.jobs,
      gaps: await this.gaps(extraSkills),
    };
  }

  // ── controllo ─────────────────────────────────────────────────────────────────

  /** Controllo periodico: rivede i CV il cui ultimo controllo riuscito è più vecchio dell'intervallo scelto. */
  async runDue(now: Date = new Date()): Promise<string[]> {
    const settings = await this.settings.get();
    if (!settings.cv.review.enabled || !this.llm.status(settings).ready) return [];
    const started: string[] = [];
    for (const baseCv of await this.activeBaseCvs(settings)) {
      const last = await this.prisma.cvReview.findFirst({
        where: { language: baseCv.language, OR: [{ status: 'ready' }, { trigger: 'schedule' }] },
        orderBy: { createdAt: 'desc' },
      });
      // un controllo fallito non viene ritentato a ogni ora: si aspetta comunque un giorno
      const wait = last?.status === 'failed' ? DAY_MS : settings.cv.review.interval_days * DAY_MS;
      if (last && now.getTime() - last.createdAt.getTime() < wait) continue;
      try {
        const review = await this.start(baseCv.language, 'schedule');
        started.push(review.id);
        await this.process(review.id);
      } catch (err) {
        this.logger.warn(`Controllo del CV ${baseCv.language} non avviato: ${(err as Error).message}`);
      }
    }
    return started;
  }

  /** Controllo chiesto dall'utente: parte subito e prosegue in background. */
  async request(language?: string): Promise<CvReviewDto[]> {
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');
    const baseCvs = (await this.activeBaseCvs(settings)).filter((b) => !language || b.language === language);
    if (baseCvs.length === 0)
      throw new BadRequestException('Nessun CV base caricato: aggiungine uno nella scheda CV del Profilo');
    const out: CvReviewDto[] = [];
    for (const baseCv of baseCvs) {
      if (this.running.has(baseCv.language)) continue;
      const review = await this.start(baseCv.language, 'manual');
      void this.process(review.id);
      out.push(review);
    }
    return out;
  }

  private async start(language: string, trigger: 'schedule' | 'manual'): Promise<CvReviewDto> {
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');
    if (this.running.has(language)) throw new ConflictException('Un controllo di questo CV è già in corso');
    const baseCv = await this.prisma.baseCv.findFirst({ where: { language, isActive: true, error: null } });
    if (!baseCv) throw new BadRequestException(`Nessun CV base caricato per la lingua "${language}"`);
    this.running.add(language);
    try {
      const row = await this.prisma.cvReview.create({
        data: { baseCvId: baseCv.id, language, trigger, provider: status.provider, model: status.model },
        include: WITH_BASE,
      });
      return this.toDto(row, baseCv.id);
    } catch (err) {
      this.running.delete(language);
      throw err;
    }
  }

  /** Non lancia mai: l'esito finisce nello stato del controllo. */
  async process(id: string): Promise<void> {
    const review = await this.prisma.cvReview.findUnique({ where: { id }, include: WITH_BASE });
    if (!review || review.status !== 'running') return;
    try {
      const settings = await this.settings.get();
      const structure = review.baseCv.structure as unknown as CvStructure;
      const extraSkills = parseExtraSkills(settings.cv.extra_skills);
      const market = await this.market(this.ownedTechnologies([structure], extraSkills));
      const gaps = await this.gaps(extraSkills);
      // ciò che l'utente ha già fatto o scartato nei controlli precedenti non va riproposto
      const earlier = await this.prisma.cvReview.findMany({
        where: { language: review.language, status: 'ready' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { suggestions: true },
      });
      const alreadyHandled = [
        ...new Set(
          earlier
            .flatMap((r) => r.suggestions as unknown as CvReviewSuggestion[])
            // ciò che è già stato applicato, fatto o scartato non va riproposto
            .filter((s) => s.status !== 'open')
            .map((s) => s.title),
        ),
      ].slice(0, 40);

      const result = await this.llm.completeJson(settings, cvReviewSchema, {
        task: 'cv_review',
        ...buildCvReviewPrompt({
          language: review.language,
          structure,
          target: {
            title: settings.profile.title,
            summary: settings.profile.summary,
            keywords: [...new Set([...settings.keywords.required_any, ...settings.keywords.boost])],
          },
          extraSkills,
          market: market.items,
          gaps,
          alreadyHandled,
        }),
        maxTokens: 16000,
        mockContext: { structure, jobTech: [] },
      });

      const handled = new Set(alreadyHandled.map((t) => t.toLowerCase()));
      const suggestions: StoredCvReviewSuggestion[] = [];
      for (const s of result.suggestions) {
        if (handled.has(s.title.toLowerCase())) continue;
        let edit: CvEdit | null = null;
        if (s.edit) {
          // stesso controllo dei CV su misura: una modifica che inventa o non è applicabile non viene proposta
          const { accepted } = validateEdits([s.edit], { structure, extraSkills, language: review.language });
          if (accepted.length === 0) continue;
          edit = s.edit;
        } else if (s.kind === 'rewrite' || s.kind === 'remove') {
          // riformulare o togliere senza dire cosa: non è una proposta utilizzabile
          continue;
        }
        suggestions.push({
          id: `s${suggestions.length + 1}`,
          kind: edit ? KIND_OF_EDIT[edit.op] : s.kind,
          title: s.title.trim(),
          reason: s.reason.trim(),
          priority: s.priority,
          ...describeEdit(edit, structure),
          applicable: !!edit,
          edit,
          status: 'open',
        });
      }
      await this.prisma.cvReview.update({
        where: { id },
        data: {
          status: 'ready',
          summary: result.summary.trim(),
          suggestions: suggestions as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      this.logger.warn(`Controllo del CV ${review.language} fallito: ${message}`);
      await this.prisma.cvReview
        .update({ where: { id }, data: { status: 'failed', error: message, finishedAt: new Date() } })
        .catch(() => undefined);
    } finally {
      this.running.delete(review.language);
    }
  }

  // ── compatibilità ATS ─────────────────────────────────────────────────────────

  /**
   * Valutazione ATS della versione attiva di un CV base: parte subito e prosegue in background,
   * il risultato resta salvato su quella versione. Usa il modello principale (con Anthropic, l'agent di Claude).
   */
  async requestAts(language: string): Promise<CvAtsReport> {
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');
    const baseCv = await this.prisma.baseCv.findFirst({ where: { language, isActive: true, error: null } });
    if (!baseCv) throw new BadRequestException(`Nessun CV base caricato per la lingua "${language}"`);
    if ((baseCv.atsReport as unknown as CvAtsReport | null)?.status === 'running') {
      throw new ConflictException('Una valutazione ATS di questo CV è già in corso');
    }
    const report: CvAtsReport = {
      status: 'running',
      error: null,
      score: null,
      summary: '',
      categories: [],
      issues: [],
      keywordsPresent: [],
      keywordsMissing: [],
      provider: status.provider,
      model: status.model,
      createdAt: new Date().toISOString(),
    };
    await this.prisma.baseCv.update({
      where: { id: baseCv.id },
      data: { atsReport: report as unknown as Prisma.InputJsonValue },
    });
    void this.processAts(baseCv.id);
    return report;
  }

  /** Non lancia mai: l'esito finisce nel report salvato sulla versione del CV. */
  async processAts(baseCvId: string): Promise<void> {
    const baseCv = await this.prisma.baseCv.findUnique({ where: { id: baseCvId } });
    const report = baseCv?.atsReport as unknown as CvAtsReport | null;
    if (!baseCv || report?.status !== 'running') return;
    let next: CvAtsReport;
    try {
      const settings = await this.settings.get();
      const structure = baseCv.structure as unknown as CvStructure;
      const extraSkills = parseExtraSkills(settings.cv.extra_skills);
      // per l'ATS conta solo ciò che è scritto nel documento: le aggiunte dichiarate altrove non valgono
      const market = await this.market(this.ownedTechnologies([structure], []));
      const result = await this.llm.completeJson(settings, cvAtsSchema, {
        task: 'cv_ats',
        ...buildCvAtsPrompt({
          language: baseCv.language,
          structure,
          facts: atsFacts(structure, baseCv.pageCount),
          target: {
            title: settings.profile.title,
            summary: settings.profile.summary,
            keywords: [...new Set([...settings.keywords.required_any, ...settings.keywords.boost, ...extraSkills])],
          },
          market: market.items,
        }),
        maxTokens: 12000,
      });
      next = {
        ...report,
        status: 'ready',
        score: Math.round(result.score),
        summary: result.summary.trim(),
        categories: result.categories.map((c) => ({ ...c, score: Math.round(c.score) })),
        issues: result.issues,
        keywordsPresent: result.keywordsPresent,
        keywordsMissing: result.keywordsMissing,
      };
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      this.logger.warn(`Valutazione ATS del CV ${baseCv.language} fallita: ${message}`);
      next = { ...report, status: 'failed', error: message };
    }
    await this.prisma.baseCv
      .update({ where: { id: baseCvId }, data: { atsReport: next as unknown as Prisma.InputJsonValue } })
      .catch(() => undefined);
  }

  // ── azioni dell'utente ────────────────────────────────────────────────────────

  private async loadReview(id: string): Promise<ReviewRow> {
    const review = await this.prisma.cvReview.findUnique({ where: { id }, include: WITH_BASE });
    if (!review) throw new NotFoundException('Controllo non trovato');
    return review;
  }

  private async activeId(language: string): Promise<string | undefined> {
    return (await this.prisma.baseCv.findFirst({ where: { language, isActive: true } }))?.id;
  }

  /**
   * Cambia lo stato di una proposta. Applicarla (o annullarne l'applicazione) rigenera il documento:
   * il risultato è una nuova versione del CV base, quella di partenza resta archiviata.
   */
  async setSuggestionStatus(
    id: string,
    suggestionId: string,
    status: CvReviewSuggestionStatus,
  ): Promise<CvReviewApplyResult> {
    const review = await this.loadReview(id);
    const suggestions = review.suggestions as unknown as StoredCvReviewSuggestion[];
    const suggestion = suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) throw new NotFoundException('Proposta non trovata');
    const wasApplied = suggestion.status === 'applied';
    if (status === 'applied' && !suggestion.edit) {
      throw new BadRequestException('Questa proposta non si può applicare in automatico: richiede una tua scelta');
    }
    suggestion.status = status;
    suggestion.applyError = null;
    if (status === 'applied' || wasApplied) return this.rebuild(review, suggestions);
    return this.saveSuggestions(review, suggestions, { applied: 0, failed: [], warning: null });
  }

  /** Applica in un colpo solo tutte le proposte aperte che l'app può applicare da sola. */
  async applyAll(id: string): Promise<CvReviewApplyResult> {
    const review = await this.loadReview(id);
    const suggestions = review.suggestions as unknown as StoredCvReviewSuggestion[];
    const targets = suggestions.filter((s) => s.status === 'open' && s.edit);
    if (targets.length === 0) throw new ConflictException('Non ci sono proposte da applicare');
    for (const s of targets) {
      s.status = 'applied';
      s.applyError = null;
    }
    return this.rebuild(review, suggestions);
  }

  private async saveSuggestions(
    review: ReviewRow,
    suggestions: StoredCvReviewSuggestion[],
    outcome: Pick<CvReviewApplyResult, 'applied' | 'failed' | 'warning'>,
    resultBaseCvId: string | null = review.resultBaseCvId,
  ): Promise<CvReviewApplyResult> {
    const updated = await this.prisma.cvReview.update({
      where: { id: review.id },
      data: { suggestions: suggestions as unknown as Prisma.InputJsonValue, resultBaseCvId },
      include: WITH_BASE,
    });
    const active = await this.prisma.baseCv.findFirst({ where: { language: review.language, isActive: true } });
    return {
      ...outcome,
      review: this.toDto(updated, active?.id),
      baseCv: toBaseCvDto(active ?? review.baseCv) as BaseCvDto,
    };
  }

  /**
   * Rigenera il documento con tutte le proposte in stato "applicata", ripartendo sempre dalla versione
   * che il controllo ha letto (mai da un documento già modificato). La versione generata viene aggiornata
   * finché nessun CV su misura la usa; altrimenti se ne crea una nuova.
   */
  private async rebuild(review: ReviewRow, suggestions: StoredCvReviewSuggestion[]): Promise<CvReviewApplyResult> {
    const active = await this.activeId(review.language);
    if (active && active !== review.baseCvId && active !== review.resultBaseCvId) {
      throw new ConflictException(
        'Nel frattempo è stato caricato un altro CV base: rifai il controllo per avere proposte applicabili',
      );
    }
    const settings = await this.settings.get();
    const origin = review.baseCv;
    const structure = origin.structure as unknown as CvStructure;
    const extraSkills = parseExtraSkills(settings.cv.extra_skills);
    const failed: CvReviewApplyResult['failed'] = [];
    const fail = (suggestion: StoredCvReviewSuggestion, reason: string) => {
      suggestion.status = 'open';
      suggestion.applyError = reason;
      failed.push({ title: suggestion.title, reason });
    };

    // le modifiche vengono validate insieme: due proposte sullo stesso paragrafo non possono convivere
    const wanted = suggestions.filter((s) => s.status === 'applied' && s.edit);
    const { accepted, rejected } = validateEdits(
      wanted.map((s) => s.edit!),
      { structure, extraSkills, language: review.language },
    );
    for (const r of rejected) {
      const suggestion = wanted.find((s) => s.edit === r.edit);
      if (suggestion) fail(suggestion, r.reason);
    }
    // ogni modifica accettata è una copia di quella proposta: si ritrova la proposta dal contenuto
    const owner = new Map<string, StoredCvReviewSuggestion>();
    for (const edit of accepted as AppliedCvEdit[]) {
      const { id: editId, status: _status, manualText: _manual, ...content } = edit;
      const suggestion = wanted.find((s) => JSON.stringify(s.edit) === JSON.stringify(content));
      if (suggestion) owner.set(editId, suggestion);
    }
    const applied = await applyEditsToDocx(await this.storage.read(origin.docxPath), accepted);
    for (const f of applied.failed) {
      const suggestion = owner.get(f.editId);
      if (suggestion) fail(suggestion, f.reason);
    }
    // una proposta la cui modifica non è finita nel documento per qualsiasi altro motivo non risulta applicata
    const landed = new Set(owner.values());
    for (const s of wanted) {
      if (s.status === 'applied' && !landed.has(s)) fail(s, 'La modifica non produce alcun cambiamento nel documento');
    }
    const count = suggestions.filter((s) => s.status === 'applied').length;

    const previous = review.resultBaseCvId
      ? await this.prisma.baseCv.findUnique({ where: { id: review.resultBaseCvId } })
      : null;
    const reusable = !!previous && previous.isActive && !(await this.baseCvs.isReferenced(previous.id));

    if (count === 0) {
      // nessuna proposta applicata: torna attiva la versione di partenza
      await this.baseCvs.activate(origin.id);
      if (previous && reusable) await this.prisma.baseCv.delete({ where: { id: previous.id } });
      return this.saveSuggestions(
        review,
        suggestions,
        { applied: 0, failed, warning: null },
        reusable ? null : review.resultBaseCvId,
      );
    }
    const stored = await this.baseCvs.store(
      review.language,
      applied.buffer,
      origin.originalFileName,
      reusable ? previous!.id : undefined,
    );
    const warning =
      origin.pageCount > 0 && stored.pageCount > origin.pageCount
        ? `Il documento ora occupa ${stored.pageCount} pagine contro ${origin.pageCount} di prima: annulla qualche proposta se vuoi tornare alla lunghezza originale.`
        : stored.error;
    return this.saveSuggestions(review, suggestions, { applied: count, failed, warning }, stored.id);
  }

  /** Attiva o disattiva il controllo periodico e ne cambia la frequenza. */
  async updateSchedule(input: { enabled?: boolean; intervalDays?: number }): Promise<CvReviewOverview> {
    const next = structuredClone(await this.settings.get());
    if (input.enabled !== undefined) next.cv.review.enabled = input.enabled;
    if (input.intervalDays !== undefined) next.cv.review.interval_days = input.intervalDays;
    await this.settings.save(next, 'cv-review');
    return this.overview();
  }

  /**
   * Cose da aggiungere nei CV: sostituisce l'elenco delle competenze ed esperienze aggiuntive
   * (lo stesso della scheda CV del Profilo), da cui i CV su misura possono attingere.
   */
  async setExtraSkills(items: string[]): Promise<CvReviewOverview> {
    const seen = new Set<string>();
    // stessa voce scritta con maiuscole diverse: resta la prima
    const clean = parseExtraSkills(items.map(singleLine).join('\n')).filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const text = clean.join('\n');
    if (text.length > 6000) throw new BadRequestException('Elenco troppo lungo: massimo 6000 caratteri');
    const next = structuredClone(await this.settings.get());
    next.cv.extra_skills = text;
    await this.settings.save(next, 'cv-review');
    return this.overview();
  }
}
