import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobDetail, JobListItem, JobsQuery, JobStatus, Paginated, Settings } from '@jobagg/shared';
import { toast } from 'sonner';
import {
  api,
  ApiError,
  type ApplicationsQuery,
  type ApplicationUpdate,
  type ApplyInput,
  type InterviewTarget,
} from './api';

export const keys = {
  profile: ['profile'] as const,
  countries: ['countries'] as const,
  history: ['profile', 'history'] as const,
  jobs: (query: JobsQuery) => ['jobs', 'list', query] as const,
  job: (id: string) => ['jobs', 'detail', id] as const,
  stats: ['stats'] as const,
  sources: ['sources'] as const,
  applications: (query: ApplicationsQuery) => ['applications', 'list', query] as const,
  application: (id: string) => ['applications', 'detail', id] as const,
  applicationStats: ['applications', 'stats'] as const,
  mailStatus: ['mail', 'status'] as const,
  interviews: (filter: { jobId?: string; applicationId?: string }) =>
    ['interviews', 'list', filter.jobId ?? '', filter.applicationId ?? ''] as const,
  interview: (id: string) => ['interviews', 'detail', id] as const,
  interviewOptions: (target: InterviewTarget | null) =>
    ['interviews', 'options', target?.kind ?? '', target?.id ?? ''] as const,
  cvSlots: ['cv', 'slots'] as const,
  cvStructure: (id: string) => ['cv', 'structure', id] as const,
  cvVersions: (language: string) => ['cv', 'versions', language] as const,
  cvOptions: (jobId: string) => ['cv', 'options', jobId] as const,
  cvForJob: (jobId: string) => ['cv', 'job', jobId] as const,
  cvDetail: (id: string) => ['cv', 'generated', id] as const,
  manualCvOptions: ['cv', 'manual', 'options'] as const,
  manualCvs: ['cv', 'manual', 'list'] as const,
  cvReview: ['cv-review'] as const,
  letterOptions: (jobId: string) => ['letters', 'options', jobId] as const,
  lettersForJob: (jobId: string) => ['letters', 'job', jobId] as const,
  letter: (id: string) => ['letters', 'detail', id] as const,
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Errore imprevisto';
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: api.profile.get, staleTime: 30_000 });
}

export function useCountries() {
  return useQuery({ queryKey: keys.countries, queryFn: api.profile.countries, staleTime: Infinity });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => api.profile.save(settings),
    onSuccess: (profile) => {
      client.setQueryData(keys.profile, profile);
      // filtri e punteggi vengono ricalcolati in background: le liste si aggiornano poco dopo
      void client.invalidateQueries({ queryKey: keys.history });
      void client.invalidateQueries({ queryKey: keys.sources });
      void client.invalidateQueries({ queryKey: keys.mailStatus });
      void client.invalidateQueries({ queryKey: keys.cvSlots });
      setTimeout(() => {
        void client.invalidateQueries({ queryKey: ['jobs'] });
        void client.invalidateQueries({ queryKey: keys.stats });
      }, 1500);
    },
  });
}

/**
 * Blocca un'azienda: la aggiunge alle aziende bloccate del Profilo e salva. Le sue offerte vengono
 * scartate dal ricalcolo in background; il toast permette di annullare subito.
 */
export function useBlockCompany() {
  const client = useQueryClient();
  const save = useSaveProfile();
  const apply = (company: string, block: boolean, onDone: () => void) => {
    const settings = client.getQueryData<{ settings: Settings }>(keys.profile)?.settings;
    if (!settings) return;
    const name = company.trim();
    const others = settings.companies.blocked.filter((c) => c.toLowerCase() !== name.toLowerCase());
    save.mutate(
      { ...settings, companies: { ...settings.companies, blocked: block ? [...others, name] : others } },
      { onSuccess: onDone, onError: (error) => toast.error(errorMessage(error)) },
    );
  };
  return {
    isPending: save.isPending,
    block: (company: string, onBlocked?: () => void) =>
      apply(company, true, () => {
        onBlocked?.();
        toast.success(`${company.trim()} bloccata: le sue offerte spariscono tra qualche secondo`, {
          action: {
            label: 'Annulla',
            onClick: () => apply(company, false, () => toast.success(`${company.trim()} non è più bloccata`)),
          },
        });
      }),
  };
}

export function useJobs(query: JobsQuery) {
  return useQuery({
    queryKey: keys.jobs(query),
    queryFn: () => api.jobs.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useJob(id: string | null) {
  return useQuery({ queryKey: keys.job(id ?? ''), queryFn: () => api.jobs.get(id!), enabled: !!id });
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: api.jobs.stats, refetchInterval: 60_000 });
}

/** Aggiornamento ottimistico di stato e note: la lista risponde subito alle scorciatoie da tastiera. */
export function useUpdateJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: JobStatus; notes?: string } }) =>
      api.jobs.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: ['jobs'] });
      const snapshots = client.getQueriesData<Paginated<JobListItem>>({ queryKey: ['jobs', 'list'] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        client.setQueryData<Paginated<JobListItem>>(key, {
          ...data,
          items: data.items.map((j) => (j.id === id ? { ...j, ...patch } : j)),
        });
      }
      const detail = client.getQueryData<JobDetail>(keys.job(id));
      if (detail) client.setQueryData<JobDetail>(keys.job(id), { ...detail, ...patch });
      return { snapshots, detail };
    },
    onError: (error, { id }, context) => {
      for (const [key, data] of context?.snapshots ?? []) client.setQueryData(key, data);
      if (context?.detail) client.setQueryData(keys.job(id), context.detail);
      toast.error(errorMessage(error));
    },
    onSettled: (_data, _error, { id }) => {
      void client.invalidateQueries({ queryKey: ['jobs', 'list'] });
      void client.invalidateQueries({ queryKey: keys.job(id) });
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

/** Stima della RAL con l'LLM per un annuncio che non la indica. */
export function useEstimateSalary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.jobs.estimateSalary(id),
    onSuccess: (job) => {
      client.setQueryData(keys.job(job.id), job);
      void client.invalidateQueries({ queryKey: ['jobs', 'list'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useApplyToJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, input }: { jobId: string; input: ApplyInput }) => api.jobs.apply(jobId, input),
    onSuccess: (_application, { jobId }) => {
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: keys.job(jobId) });
      void client.invalidateQueries({ queryKey: ['applications'] });
      void client.invalidateQueries({ queryKey: ['cv', 'generated'] });
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useSources() {
  return useQuery({
    queryKey: keys.sources,
    queryFn: api.sources.list,
    // mentre una raccolta è in corso la pagina si aggiorna da sola
    refetchInterval: (query) => (query.state.data?.some((s) => s.running) ? 2000 : 30_000),
  });
}

export function useApplications(query: ApplicationsQuery) {
  return useQuery({
    queryKey: keys.applications(query),
    queryFn: () => api.applications.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useApplication(id: string | null) {
  return useQuery({ queryKey: keys.application(id ?? ''), queryFn: () => api.applications.get(id!), enabled: !!id });
}

export function useApplicationStats() {
  return useQuery({ queryKey: keys.applicationStats, queryFn: api.applications.stats });
}

export function useUpdateApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ApplicationUpdate }) => api.applications.update(id, patch),
    onSuccess: (application) => {
      client.setQueryData(keys.application(application.id), application);
      void client.invalidateQueries({ queryKey: ['applications'] });
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['cv', 'generated'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Collegamento a Gmail e ultima sincronizzazione delle candidature. */
export function useMailStatus() {
  return useQuery({
    queryKey: keys.mailStatus,
    queryFn: api.mail.status,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 60_000),
  });
}

export function useInterviews(filter: { jobId?: string; applicationId?: string } = {}, enabled = true) {
  return useQuery({ queryKey: keys.interviews(filter), queryFn: () => api.interviews.list(filter), enabled });
}

/** Sessione di colloquio: si aggiorna da sola mentre domande o valutazioni sono in corso. */
export function useInterview(id: string | undefined) {
  return useQuery({
    queryKey: keys.interview(id ?? ''),
    queryFn: () => api.interviews.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      const waiting =
        data &&
        (data.status === 'generating' ||
          data.reportStatus === 'pending' ||
          data.answers.some((a) => a.status === 'pending'));
      return waiting ? 2000 : false;
    },
  });
}

/**
 * Colloquio proposto in homepage. La scelta è casuale lato API: resta ferma finché non se ne chiede
 * un'altra (`draw` cresce a ogni richiesta, `exclude` = candidatura appena mostrata), senza cambiare
 * a ogni ritorno sulla scheda.
 */
export function useInterviewSuggestion(pick: { draw: number; exclude?: string }, enabled: boolean) {
  return useQuery({
    queryKey: ['interview-suggestion', pick.draw],
    queryFn: () => api.interviews.suggestion(pick.exclude),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
  });
}

export function useInterviewOptions(target: InterviewTarget | null) {
  return useQuery({
    queryKey: keys.interviewOptions(target),
    queryFn: () => api.interviews.options(target!),
    enabled: !!target,
    staleTime: 5_000,
  });
}

export function useCvSlots() {
  return useQuery({ queryKey: keys.cvSlots, queryFn: api.cv.slots });
}

export function useCvOptions(jobId: string | null) {
  return useQuery({
    queryKey: keys.cvOptions(jobId ?? ''),
    queryFn: () => api.cv.options(jobId!),
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

export function useManualCvOptions(enabled: boolean) {
  return useQuery({ queryKey: keys.manualCvOptions, queryFn: api.cv.manualOptions, enabled, staleTime: 10_000 });
}

/** CV generati da una descrizione incollata a mano (non hanno un annuncio in cui ritrovarli). */
export function useManualCvs(enabled: boolean) {
  return useQuery({ queryKey: keys.manualCvs, queryFn: api.cv.listManual, enabled });
}

export function useCvForJob(jobId: string | null) {
  return useQuery({ queryKey: keys.cvForJob(jobId ?? ''), queryFn: () => api.cv.listForJob(jobId!), enabled: !!jobId });
}

export function useLetterOptions(jobId: string | null) {
  return useQuery({
    queryKey: keys.letterOptions(jobId ?? ''),
    queryFn: () => api.letters.options(jobId!),
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

export function useLettersForJob(jobId: string | null) {
  return useQuery({
    queryKey: keys.lettersForJob(jobId ?? ''),
    queryFn: () => api.letters.listForJob(jobId!),
    enabled: !!jobId,
  });
}

/** Lettera di candidatura: si aggiorna da sola mentre il modello la sta scrivendo. */
export function useLetter(id: string | undefined) {
  return useQuery({
    queryKey: keys.letter(id ?? ''),
    queryFn: () => api.letters.detail(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 2000 : false),
  });
}

/** Sezione "Migliora CV": si aggiorna da sola mentre un controllo è in corso. */
export function useCvReview() {
  return useQuery({
    queryKey: keys.cvReview,
    queryFn: api.cvReview.overview,
    refetchInterval: (query) =>
      query.state.data?.languages.some((l) => l.review?.status === 'running' || l.ats?.status === 'running')
        ? 2500
        : false,
  });
}
