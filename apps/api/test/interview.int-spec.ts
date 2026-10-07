import { InterviewService } from '../src/interview/interview.service';
import type { SpeechToTextService } from '../src/interview/speech-to-text.service';
import { LlmService } from '../src/llm/llm.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { connect, env, fakeAdapter, jobInput, resetDatabase, seedSettings, testSettings } from './helpers';

const stt = {
  available: async () => true,
  transcribe: async () => 'testo trascritto',
} as unknown as SpeechToTextService;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timeout in attesa dello stato atteso');
}

/** Colloqui simulati contro un PostgreSQL reale, con il provider LLM finto (nessuna rete). */
describe('colloqui simulati', () => {
  let prisma: PrismaService;
  let jobId: string;

  beforeAll(async () => {
    prisma = await connect();
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    const settings = await seedSettings(prisma, testSettings({ scoring: { llm: { enabled: true } } }));
    const adapter = fakeAdapter('fake', [
      jobInput({
        externalId: '1',
        descriptionOriginal:
          '<p>We build APIs with Node.js, NestJS and PostgreSQL. Fully remote team across Europe. You will design services, review code, mentor colleagues and own features from the first draft to production.</p>',
      }),
    ]);
    await new PipelineService(prisma).ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());
    jobId = (await prisma.job.findFirstOrThrow()).id;
  });
  afterAll(() => prisma.$disconnect());

  it('genera domande tecniche e comportamentali, valuta le risposte e sopravvive alla cancellazione dell’annuncio', async () => {
    const settings = await seedSettings(prisma, testSettings({ scoring: { llm: { enabled: true } } }));
    const interviews = new InterviewService(
      prisma,
      settings,
      new LlmService({ ...env, llmProviderOverride: 'mock' }),
      stt,
    );

    const options = await interviews.options({ kind: 'job', id: jobId });
    expect(options).toMatchObject({ available: true, external: false, speechToText: true, suggestedLanguage: 'en' });

    const created = await interviews.create({ kind: 'job', id: jobId }, { language: 'en', questionCount: 6 });
    expect(created).toMatchObject({
      status: 'generating',
      jobTitle: 'Senior TypeScript Engineer',
      language: 'en',
      attempt: 1,
    });
    const ready = await until(
      () => interviews.get(created.id),
      (s) => s.status !== 'generating',
    );
    expect(ready.status).toBe('ready');
    expect(ready.questions).toHaveLength(6);
    expect(ready.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect(ready.questions.filter((q) => q.kind === 'technical')).toHaveLength(3);
    expect(ready.questions.filter((q) => q.kind === 'behavioral')).toHaveLength(3);

    expect(await interviews.transcribe(Buffer.from('audio'), 'audio/webm', 'en')).toEqual({ text: 'testo trascritto' });
    await expect(interviews.transcribe(Buffer.alloc(0), 'audio/webm', 'en')).rejects.toThrow(/vuota/);

    const answered = await interviews.answer(created.id, 'q1', {
      transcript: 'I have been building APIs with NestJS and PostgreSQL for five years in a remote team.',
      inputMode: 'audio',
      durationSec: 42,
    });
    expect(answered.answers[0]).toMatchObject({ questionId: 'q1', inputMode: 'audio', durationSec: 42 });
    // la valutazione parte in background (con il provider finto può essere già conclusa)
    expect(['pending', 'ready']).toContain(answered.answers[0]!.status);
    const evaluated = await until(
      () => interviews.get(created.id),
      (s) => s.answers[0]?.status !== 'pending',
    );
    expect(evaluated.answers[0]).toMatchObject({ status: 'ready', feedback: { score: 3 } });
    expect(evaluated).toMatchObject({ answeredCount: 1, averageScore: 3 });

    // una nuova risposta alla stessa domanda sostituisce la precedente
    await interviews.answer(created.id, 'q1', { transcript: 'Short answer.', inputMode: 'text' });
    const replaced = await until(
      () => interviews.get(created.id),
      (s) => s.answers[0]?.status === 'ready',
    );
    expect(replaced.answers).toHaveLength(1);
    expect(replaced.answers[0]).toMatchObject({
      transcript: 'Short answer.',
      inputMode: 'text',
      feedback: { score: 2 },
    });

    await expect(interviews.answer(created.id, 'q99', { transcript: 'x', inputMode: 'text' })).rejects.toThrow(
      /Domanda non trovata/,
    );
    await expect(interviews.answer(created.id, 'q2', { transcript: '   ', inputMode: 'text' })).rejects.toThrow(
      /vuota/,
    );

    // lo storico resta anche senza l'annuncio
    await prisma.job.deleteMany();
    expect(await interviews.list()).toEqual([
      expect.objectContaining({ id: created.id, jobId: null, answeredCount: 1 }),
    ]);
    await interviews.remove(created.id);
    expect(await prisma.interviewAnswer.count()).toBe(0);
  });

  it('provider esterno: senza consenso non parte; generazione interrotta da un riavvio risulta fallita e si riprova', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({ scoring: { llm: { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5' } } }),
    );
    const external = new InterviewService(
      prisma,
      settings,
      new LlmService({ ...env, llmProviderOverride: '', anthropicApiKey: 'test-key' }),
      stt,
    );
    expect(await external.options({ kind: 'job', id: jobId })).toMatchObject({
      available: true,
      external: true,
      consentGiven: false,
    });
    await expect(
      external.create({ kind: 'job', id: jobId }, { language: 'it', questionCount: 6 }),
    ).rejects.toMatchObject({
      response: { code: 'consent_required' },
    });
    expect(await prisma.interviewSession.count()).toBe(0);

    // sessione rimasta "in generazione" (es. riavvio): diventa fallita e si può riprovare
    const mock = new InterviewService(prisma, settings, new LlmService({ ...env, llmProviderOverride: 'mock' }), stt);
    const stale = await prisma.interviewSession.create({
      data: { jobId, jobTitle: 't', company: 'c', language: 'it', questionCount: 4, provider: 'mock', model: 'm' },
    });
    await mock.closeInterrupted();
    expect(await mock.get(stale.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('riavvio') });
    await mock.retry(stale.id);
    const retried = await until(
      () => mock.get(stale.id),
      (s) => s.status !== 'generating',
    );
    expect(retried).toMatchObject({ status: 'ready', questionCount: 4 });
    expect(retried.questions[0]!.text).toContain('"t"');
  });

  it('da una candidatura senza descrizione: va incollata; ogni tentativo è numerato e ha domande nuove', async () => {
    const settings = await seedSettings(prisma, testSettings({ scoring: { llm: { enabled: true } } }));
    const llm = new LlmService({ ...env, llmProviderOverride: 'mock' });
    const prompts: string[] = [];
    const original = llm.completeJson.bind(llm);
    jest.spyOn(llm, 'completeJson').mockImplementation(async (s, schema, request) => {
      if (request.task === 'interview_questions') prompts.push(request.system);
      return original(s, schema, request);
    });
    const interviews = new InterviewService(prisma, settings, llm, stt);
    // candidatura importata dal foglio: niente annuncio, niente descrizione
    const application = await prisma.application.create({
      data: {
        appliedAt: new Date('2026-09-01T12:00:00Z'),
        channel: 'job_board',
        snapshot: {
          title: 'Backend Developer',
          company: 'Globex',
          source: 'Indeed',
          sourceUrl: '',
          salaryFound: false,
          techStack: {},
          contractType: 'unknown',
          location: '',
          descriptionOriginal: '',
        },
      },
    });
    const target = { kind: 'application' as const, id: application.id };

    // proposta in homepage: senza candidature inviate non c'è nulla da proporre
    await prisma.application.update({ where: { id: application.id }, data: { currentStatus: 'skipped' } });
    expect(await interviews.suggestion()).toBeNull();
    await prisma.application.update({ where: { id: application.id }, data: { currentStatus: 'applied' } });
    // senza il testo dell'annuncio la candidatura non viene proposta
    expect(await interviews.suggestion()).toBeNull();

    expect(await interviews.options(target)).toMatchObject({
      title: 'Backend Developer',
      company: 'Globex',
      descriptionAvailable: false,
      previousAttempts: 0,
      suggestedLanguage: 'auto',
    });
    await expect(interviews.create(target, { language: 'auto', questionCount: 4 })).rejects.toMatchObject({
      response: { code: 'description_required' },
    });

    const pasted =
      'Wir suchen einen Backend Developer mit Erfahrung in Node.js, TypeScript und PostgreSQL. Du arbeitest in einem kleinen Team an unserer Plattform, entwirfst APIs und kümmerst dich um Qualität und Tests.';
    const first = await interviews.create(target, { language: 'auto', questionCount: 4, description: pasted });
    expect(first).toMatchObject({ attempt: 1, language: 'de', applicationId: application.id, jobId: null });
    const firstReady = await until(
      () => interviews.get(first.id),
      (s) => s.status !== 'generating',
    );
    expect(firstReady.status).toBe('ready');
    // la descrizione incollata resta con la candidatura
    const updated = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect((updated.snapshot as { descriptionOriginal: string }).descriptionOriginal).toBe(pasted);
    expect(await interviews.options(target)).toMatchObject({ descriptionAvailable: true, previousAttempts: 1 });

    // nuovo tentativo: numerato, con le domande precedenti da evitare e temi scelti a caso
    const second = await interviews.again(first.id);
    expect(second).toMatchObject({ attempt: 2, language: 'de', applicationId: application.id });
    const secondReady = await until(
      () => interviews.get(second.id),
      (s) => s.status !== 'generating',
    );
    expect(secondReady.questions.map((q) => q.text)).not.toEqual(firstReady.questions.map((q) => q.text));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('Do NOT repeat');
    expect(prompts[1]).toContain('attempt number 2');
    expect(prompts[1]).toContain('Do NOT repeat');
    expect(prompts[1]).toContain(firstReady.questions[0]!.text);

    const history = await interviews.list({ applicationId: application.id });
    expect(history.map((h) => h.attempt)).toEqual([2, 1]);

    // ora che la descrizione è salvata la candidatura viene proposta, anche se esclusa finché è l'unica
    expect(await interviews.suggestion(application.id)).toMatchObject({
      applicationId: application.id,
      title: 'Backend Developer',
      company: 'Globex',
      currentStatus: 'applied',
      previousAttempts: 2,
      alternatives: 0,
    });
    // con due candidature "proponine un altro" esclude quella appena mostrata
    const other = await prisma.application.create({
      data: {
        appliedAt: new Date('2026-09-10T12:00:00Z'),
        channel: 'job_board',
        snapshot: { ...(updated.snapshot as object), title: 'Platform Engineer', company: 'Initech' },
      },
    });
    for (let i = 0; i < 5; i++) {
      expect((await interviews.suggestion(other.id))!.applicationId).toBe(application.id);
    }
    expect(await interviews.suggestion(other.id)).toMatchObject({
      previousAttempts: 2,
      alternatives: 1,
      language: 'de',
    });
    expect((await interviews.suggestion(application.id))!.title).toBe('Platform Engineer');
  });

  it('conversazione a voce: apertura, contro-domande limitate, chiusura e valutazione finale', async () => {
    const settings = await seedSettings(prisma, testSettings({ scoring: { llm: { enabled: true } } }));
    const llm = new LlmService({ ...env, llmProviderOverride: 'mock' });
    const requests: Array<{ task: string; fast?: boolean }> = [];
    const original = llm.completeJson.bind(llm);
    jest.spyOn(llm, 'completeJson').mockImplementation(async (s, schema, request) => {
      requests.push({ task: request.task, fast: request.fast });
      return original(s, schema, request);
    });
    const interviews = new InterviewService(prisma, settings, llm, stt);
    const created = await interviews.create(
      { kind: 'job', id: jobId },
      { language: 'en', questionCount: 4, mode: 'live' },
    );
    expect(created.mode).toBe('live');
    await expect(interviews.liveStart(created.id)).rejects.toThrow(/non sono ancora pronte/);
    await until(
      () => interviews.get(created.id),
      (s) => s.status !== 'generating',
    );

    // apertura: saluto fisso + prima domanda, senza chiamare l'LLM; ripeterla non duplica nulla
    const opened = await interviews.liveStart(created.id);
    expect(opened.transcript).toHaveLength(1);
    expect(opened.transcript[0]).toMatchObject({ role: 'interviewer', kind: 'question', questionId: 'q1' });
    expect(opened.transcript[0]!.text).toContain(opened.questions[0]!.text);
    expect((await interviews.liveStart(created.id)).transcript).toHaveLength(1);
    expect(requests.filter((r) => r.task === 'interview_turn')).toHaveLength(0);

    // risposta troppo breve: contro-domanda sulla stessa domanda, con il modello rapido
    let session = await interviews.liveTurn(created.id, { text: 'Yes I did.', durationSec: 2 });
    expect(session.transcript.at(-1)).toMatchObject({ role: 'interviewer', kind: 'follow_up', questionId: 'q1' });
    expect(requests.at(-1)).toMatchObject({ task: 'interview_turn', fast: true });
    // una sola contro-domanda per domanda: poi si passa alla successiva anche con una risposta breve
    session = await interviews.liveTurn(created.id, { text: 'Not sure.', durationSec: 1 });
    expect(session.transcript.at(-1)).toMatchObject({ kind: 'question', questionId: 'q2' });
    // candidato bloccato: l'intervistatore dà un piccolo aiuto e resta sulla stessa domanda
    session = await interviews.liveTurn(created.id, { text: "I don't know.", durationSec: 1 });
    expect(session.transcript.at(-1)).toMatchObject({ role: 'interviewer', kind: 'hint', questionId: 'q2' });
    expect(session.questions[1]!.hints).toHaveLength(2);
    await expect(interviews.liveTurn(created.id, { text: '   ' })).rejects.toThrow(/vuota/);

    const long =
      'In my last project I designed the caching layer with Redis and explicit invalidation, measured the latency before and after, and shared the results with the team in a written proposal.';
    for (const expected of ['q3', 'q4']) {
      session = await interviews.liveTurn(created.id, { text: long, durationSec: 12 });
      expect(session.transcript.at(-1)).toMatchObject({ kind: 'question', questionId: expected });
    }
    session = await interviews.liveTurn(created.id, { text: long, durationSec: 12 });
    expect(session.transcript.at(-1)).toMatchObject({ role: 'interviewer', kind: 'closing', questionId: null });
    expect(session.finishedAt).not.toBeNull();
    expect(session).toMatchObject({ answeredCount: 4 });
    await expect(interviews.liveTurn(created.id, { text: 'One more thing' })).rejects.toThrow(/già concluso/);

    const done = await until(
      () => interviews.get(created.id),
      (s) => s.reportStatus !== 'pending',
    );
    expect(done.reportStatus).toBe('ready');
    expect(done.report).toMatchObject({
      overallScore: 3,
      delivery: { answers: 6, speakingSeconds: 40 },
    });
    expect(done.report!.delivery.wordsPerMinute).toBeGreaterThan(60);
    expect(done).toMatchObject({ overallScore: 3 });
    expect(requests.at(-1)).toMatchObject({ task: 'interview_report' });
    expect(requests.at(-1)!.fast).toBeUndefined();
  });

  it('colloquio a turni: la valutazione finale usa domande e risposte date', async () => {
    const settings = await seedSettings(prisma, testSettings({ scoring: { llm: { enabled: true } } }));
    const interviews = new InterviewService(
      prisma,
      settings,
      new LlmService({ ...env, llmProviderOverride: 'mock' }),
      stt,
    );
    const created = await interviews.create({ kind: 'job', id: jobId }, { language: 'en', questionCount: 4 });
    await until(
      () => interviews.get(created.id),
      (s) => s.status !== 'generating',
    );
    await expect(interviews.finish(created.id)).rejects.toThrow(/nessuna risposta/);
    await expect(interviews.liveStart(created.id)).rejects.toThrow(/non è una conversazione/);
    await interviews.answer(created.id, 'q1', {
      transcript: 'I would use PostgreSQL with indexes.',
      inputMode: 'text',
    });
    await interviews.finish(created.id);
    const done = await until(
      () => interviews.get(created.id),
      (s) => s.reportStatus !== 'pending',
    );
    expect(done.report).toMatchObject({ delivery: { answers: 1, wordsPerMinute: null } });
  });
});
