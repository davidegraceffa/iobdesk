import type {
  ApplicationChannel,
  ApplicationDto,
  ApplicationImportResult,
  ApplicationStats,
  ApplicationStatus,
  BaseCvDto,
  BaseCvStructureDto,
  CoverLetterDto,
  CountryDto,
  CvGenerateInfo,
  CvAtsReport,
  CvGenerateRequest,
  CvReviewApplyResult,
  CvReviewDto,
  CvReviewOverview,
  CvReviewSuggestionStatus,
  CvManualGenerateRequest,
  CvSectionOverride,
  CvSlotDto,
  FetchRunDto,
  FieldError,
  GeneratedCvDetail,
  GeneratedCvDto,
  InterviewOptions,
  InterviewSessionDto,
  InterviewSessionSummary,
  InterviewSuggestionDto,
  JobDetail,
  JobListItem,
  JobsQuery,
  JobStatus,
  MailSyncRunDto,
  MailSyncStatusDto,
  Paginated,
  ProfileHistoryEntry,
  ProfileImportPreview,
  ProfilePreviewResult,
  ProfileResponse,
  Settings,
  SourceStatusDto,
  StatsDto,
} from '@jobagg/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** errori di validazione per campo (salvataggio del Profilo) */
    readonly errors: FieldError[] = [],
    readonly code?: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('API non raggiungibile: controlla che i container siano avviati', 0);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const d = (data ?? {}) as { message?: string | string[]; errors?: FieldError[]; code?: string };
    const message = Array.isArray(d.message) ? d.message.join('; ') : (d.message ?? `Errore ${response.status}`);
    const friendly = response.status === 413 ? 'File troppo grande (massimo 10 MB)' : message;
    throw new ApiError(friendly, response.status, d.errors ?? [], d.code, d as Record<string, unknown>);
  }
  return data as T;
}

function qs(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface ApplyInput {
  appliedAt?: string;
  channel?: ApplicationChannel;
  notes?: string;
  contactName?: string;
  contactEmail?: string;
  generatedCvId?: string;
}

export interface ManualApplicationInput extends ApplyInput {
  title: string;
  company: string;
  url?: string;
  source?: string;
  location?: string;
  salaryRawText?: string;
  description?: string;
  country?: string;
  cvSent?: string;
  cvLanguage?: string;
}

export interface ApplicationUpdate {
  /** RAL come testo libero; stringa vuota per toglierla */
  salaryRawText?: string;
  currentStatus?: ApplicationStatus;
  eventNote?: string;
  notes?: string;
  contactName?: string;
  contactEmail?: string;
  appliedAt?: string;
  generatedCvId?: string | null;
  country?: string;
  cvSent?: string;
  cvLanguage?: string;
}

export interface ApplicationsQuery {
  status?: ApplicationStatus | '';
  from?: string;
  to?: string;
  company?: string;
  source?: string;
  country?: string;
  q?: string;
  order?: 'asc' | 'desc';
}

export interface EditChange {
  editId: string;
  status?: 'accepted' | 'rejected';
  manualText?: string | null;
}

/** Annuncio o candidatura su cui simulare un colloquio. */
export interface InterviewTarget {
  kind: 'job' | 'application';
  id: string;
}

const targetPath = (target: InterviewTarget) => `${target.kind === 'job' ? 'jobs' : 'applications'}/${target.id}`;

export const api = {
  profile: {
    get: () => request<ProfileResponse>('GET', '/profile'),
    save: (settings: Settings) => request<ProfileResponse>('PUT', '/profile', settings),
    preview: (settings: Settings) => request<ProfilePreviewResult>('POST', '/profile/preview', settings),
    history: () => request<ProfileHistoryEntry[]>('GET', '/profile/history'),
    restore: (id: string) => request<ProfileResponse>('POST', `/profile/history/${id}/restore`),
    countries: () => request<CountryDto[]>('GET', '/profile/countries'),
    import: (content: string, dryRun: boolean) =>
      request<ProfileImportPreview>('POST', `/profile/import${qs({ dryRun: dryRun ? 'true' : undefined })}`, {
        content,
      }),
    exportUrl: (format: 'yaml' | 'json') => `${BASE}/profile/export?format=${format}`,
  },
  jobs: {
    list: (query: JobsQuery) => request<Paginated<JobListItem>>('GET', `/jobs${qs(query)}`),
    get: (id: string) => request<JobDetail>('GET', `/jobs/${id}`),
    update: (id: string, patch: { status?: JobStatus; notes?: string }) =>
      request<JobDetail>('PATCH', `/jobs/${id}`, patch),
    estimateSalary: (id: string) => request<JobDetail>('POST', `/jobs/${id}/salary-estimate`),
    apply: (id: string, input: ApplyInput) => request<ApplicationDto>('POST', `/jobs/${id}/apply`, input),
    exportUrl: (query: JobsQuery) => `${BASE}/jobs/export${qs({ ...query, page: undefined, pageSize: undefined })}`,
    stats: () => request<StatsDto>('GET', '/stats'),
  },
  sources: {
    list: () => request<SourceStatusDto[]>('GET', '/sources'),
    fetch: (source?: string) => request<{ runIds: string[] }>('POST', `/fetch${qs({ source })}`),
    runs: (source?: string) => request<FetchRunDto[]>('GET', `/fetch/runs${qs({ source, limit: 30 })}`),
  },
  applications: {
    list: (query: ApplicationsQuery = {}) => request<ApplicationDto[]>('GET', `/applications${qs(query)}`),
    get: (id: string) => request<ApplicationDto>('GET', `/applications/${id}`),
    update: (id: string, patch: ApplicationUpdate) => request<ApplicationDto>('PATCH', `/applications/${id}`, patch),
    create: (input: ManualApplicationInput) => request<ApplicationDto>('POST', '/applications', input),
    stats: () => request<ApplicationStats>('GET', '/applications/stats'),
    countries: () => request<string[]>('GET', '/applications/countries'),
    import: (content: string, dryRun: boolean) =>
      request<ApplicationImportResult>('POST', `/applications/import${qs({ dryRun: dryRun ? 'true' : undefined })}`, {
        content,
      }),
    exportUrl: (query: ApplicationsQuery = {}) => `${BASE}/applications/export${qs({ ...query, format: 'csv' })}`,
  },
  interviews: {
    options: (target: InterviewTarget) => request<InterviewOptions>('GET', `/${targetPath(target)}/interview/options`),
    create: (
      target: InterviewTarget,
      input: {
        language: string;
        questionCount: number;
        mode?: 'live' | 'turns';
        consentExternal?: boolean;
        description?: string;
      },
    ) => request<InterviewSessionDto>('POST', `/${targetPath(target)}/interviews`, input),
    suggestion: (exclude?: string) =>
      request<InterviewSuggestionDto | null>('GET', `/interviews/suggestion${qs({ exclude })}`),
    liveStart: (id: string) => request<InterviewSessionDto>('POST', `/interviews/${id}/live/start`),
    liveTurn: (id: string, input: { text: string; durationSec?: number }) =>
      request<InterviewSessionDto>('POST', `/interviews/${id}/live/turn`, input),
    /** come liveTurn, ma la replica dell'intervistatore arriva a pezzi (`onSay`) mentre il modello la scrive */
    liveTurnStream: async (
      id: string,
      input: { text: string; durationSec?: number },
      onSay: (delta: string) => void,
    ): Promise<InterviewSessionDto> => {
      let response: Response;
      try {
        response = await fetch(`${BASE}/interviews/${id}/live/turn/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
      } catch {
        throw new ApiError('API non raggiungibile: controlla che i container siano avviati', 0);
      }
      if (!response.ok || !response.body) throw new ApiError(`Errore ${response.status}`, response.status);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let session: InterviewSessionDto | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data) as unknown;
          if (event === 'say') onSay((payload as { text: string }).text);
          else if (event === 'done') session = payload as InterviewSessionDto;
          else if (event === 'error') {
            const { message, status } = payload as { message: string; status: number };
            throw new ApiError(message, status);
          }
        }
        if (done) break;
      }
      if (!session) throw new ApiError('Risposta interrotta: riprova', 0);
      return session;
    },
    finish: (id: string) => request<InterviewSessionDto>('POST', `/interviews/${id}/finish`),
    again: (id: string, consentExternal?: boolean) =>
      request<InterviewSessionDto>('POST', `/interviews/${id}/again`, { consentExternal }),
    list: (filter: { jobId?: string; applicationId?: string } = {}) =>
      request<InterviewSessionSummary[]>('GET', `/interviews${qs(filter)}`),
    get: (id: string) => request<InterviewSessionDto>('GET', `/interviews/${id}`),
    retry: (id: string) => request<InterviewSessionDto>('POST', `/interviews/${id}/retry`),
    remove: (id: string) => request<void>('DELETE', `/interviews/${id}`),
    answer: (
      id: string,
      questionId: string,
      input: { transcript: string; inputMode: 'audio' | 'text'; durationSec?: number },
    ) => request<InterviewSessionDto>('PUT', `/interviews/${id}/answers/${questionId}`, input),
    speechToText: () => request<{ available: boolean }>('GET', '/interviews/speech-to-text'),
    textToSpeech: () => request<{ languages: string[] }>('GET', '/interviews/text-to-speech'),
    /** audio WAV del testo, dalla voce neurale locale */
    speak: async (text: string, language: string): Promise<Blob> => {
      const response = await fetch(`${BASE}/interviews/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
      });
      if (!response.ok) throw new ApiError(`Errore ${response.status}`, response.status);
      return response.blob();
    },
    transcribe: (audio: Blob, language: string, sessionId: string) => {
      const form = new FormData();
      form.append('language', language);
      form.append('sessionId', sessionId);
      form.append('audio', audio, audio.type.includes('mp4') ? 'answer.mp4' : 'answer.webm');
      return request<{ text: string }>('POST', '/interviews/transcribe', form);
    },
  },
  mail: {
    status: () => request<MailSyncStatusDto>('GET', '/mail/status'),
    startOAuth: () => request<{ url: string }>('POST', '/mail/oauth/start'),
    disconnect: () => request<void>('DELETE', '/mail/connection'),
    sync: (dryRun: boolean) =>
      request<MailSyncRunDto>('POST', `/mail/sync${qs({ dryRun: dryRun ? 'true' : undefined })}`),
  },
  cv: {
    slots: () => request<CvSlotDto[]>('GET', '/cv/base'),
    upload: (file: File, language: string) => {
      const form = new FormData();
      form.append('language', language);
      form.append('file', file);
      return request<BaseCvDto>('POST', '/cv/base', form);
    },
    structure: (id: string) => request<BaseCvStructureDto>('GET', `/cv/base/${id}/structure`),
    updateStructure: (id: string, overrides: Record<string, CvSectionOverride>) =>
      request<BaseCvStructureDto>('PUT', `/cv/base/${id}/structure`, { overrides }),
    versions: (language: string) => request<BaseCvDto[]>('GET', `/cv/base/${language}/versions`),
    basePdfUrl: (id: string) => `${BASE}/cv/base/${id}/pdf`,
    baseDocxUrl: (id: string) => `${BASE}/cv/base/${id}/docx`,
    options: (jobId: string) => request<CvGenerateInfo>('GET', `/jobs/${jobId}/cv/options`),
    generate: (jobId: string, input: CvGenerateRequest) =>
      request<{ generatedCvId: string; queueJobId: string | null }>('POST', `/jobs/${jobId}/cv`, input),
    listForJob: (jobId: string) => request<GeneratedCvDto[]>('GET', `/jobs/${jobId}/cv`),
    manualOptions: () => request<CvGenerateInfo>('GET', '/cv/manual/options'),
    listManual: () => request<GeneratedCvDto[]>('GET', '/cv/manual'),
    generateManual: (input: CvManualGenerateRequest) =>
      request<{ generatedCvId: string; queueJobId: string | null }>('POST', '/cv/manual', input),
    detail: (id: string) => request<GeneratedCvDetail>('GET', `/cv/generated/${id}`),
    generateEmail: (id: string, instructions?: string) =>
      request<GeneratedCvDetail>('POST', `/cv/generated/${id}/email`, { instructions }),
    updateEmail: (id: string, patch: { subject?: string; body?: string }) =>
      request<GeneratedCvDetail>('PATCH', `/cv/generated/${id}/email`, patch),
    patchEdits: (id: string, changes: EditChange[]) =>
      request<GeneratedCvDetail>('PATCH', `/cv/generated/${id}/edits`, { changes }),
    regenerate: (id: string, input: Partial<CvGenerateRequest>) =>
      request<{ generatedCvId: string; queueJobId: string | null }>('POST', `/cv/generated/${id}/regenerate`, input),
    pdfUrl: (id: string, version?: string | number) => `${BASE}/cv/generated/${id}/pdf${qs({ v: version })}`,
    pdfDownloadUrl: (id: string) => `${BASE}/cv/generated/${id}/pdf?download=1`,
    docxUrl: (id: string) => `${BASE}/cv/generated/${id}/docx`,
    thumbnailUrl: (id: string, page: number, version?: string | number) =>
      `${BASE}/cv/generated/${id}/thumbnails/${page}${qs({ v: version })}`,
    eventsUrl: (id: string) => `${BASE}/cv/generated/${id}/events`,
  },
  cvReview: {
    overview: () => request<CvReviewOverview>('GET', '/cv/review'),
    run: (language?: string) => request<CvReviewDto[]>('POST', '/cv/review/run', { language }),
    schedule: (input: { enabled?: boolean; intervalDays?: number }) =>
      request<CvReviewOverview>('PUT', '/cv/review/schedule', input),
    setExtraSkills: (items: string[]) => request<CvReviewOverview>('PUT', '/cv/review/extra-skills', { items }),
    setSuggestionStatus: (id: string, suggestionId: string, status: CvReviewSuggestionStatus) =>
      request<CvReviewApplyResult>('PATCH', `/cv/review/${id}/suggestions/${suggestionId}`, { status }),
    ats: (language: string) => request<CvAtsReport>('POST', '/cv/review/ats', { language }),
    applyAll: (id: string) => request<CvReviewApplyResult>('POST', `/cv/review/${id}/apply`),
  },
  letters: {
    options: (jobId: string) => request<CvGenerateInfo>('GET', `/jobs/${jobId}/cover-letters/options`),
    generate: (jobId: string, input: CvGenerateRequest) =>
      request<CoverLetterDto>('POST', `/jobs/${jobId}/cover-letters`, input),
    listForJob: (jobId: string) => request<CoverLetterDto[]>('GET', `/jobs/${jobId}/cover-letters`),
    detail: (id: string) => request<CoverLetterDto>('GET', `/cover-letters/${id}`),
    update: (id: string, patch: { subject?: string; body?: string }) =>
      request<CoverLetterDto>('PATCH', `/cover-letters/${id}`, patch),
    regenerate: (id: string, input: Partial<CvGenerateRequest>) =>
      request<CoverLetterDto>('POST', `/cover-letters/${id}/regenerate`, input),
    remove: (id: string) => request<void>('DELETE', `/cover-letters/${id}`),
    pdfUrl: (id: string, version?: string | number) => `${BASE}/cover-letters/${id}/pdf${qs({ v: version })}`,
    pdfDownloadUrl: (id: string) => `${BASE}/cover-letters/${id}/pdf?download=1`,
    docxUrl: (id: string) => `${BASE}/cover-letters/${id}/docx`,
  },
};
