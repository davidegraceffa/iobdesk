import type { JobListItem, JobsQuery } from '@jobagg/shared';
import { Download, FilePlus2, Inbox, Keyboard, Radio, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApplyDialog, AskAppliedDialog } from '@/components/jobs/ApplyDialog';
import { InterviewSuggestionCard } from '@/components/interview/InterviewSuggestionCard';
import { StartInterviewDialog } from '@/components/interview/StartInterviewDialog';
import { GenerateCvDialog } from '@/components/jobs/GenerateCvDialog';
import { GenerateLetterDialog } from '@/components/jobs/GenerateLetterDialog';
import { ManualCvDialog } from '@/components/jobs/ManualCvDialog';
import { JobCard, type CvAvailability } from '@/components/jobs/JobCard';
import { JobDetailSheet } from '@/components/jobs/JobDetailSheet';
import { countActiveFilters, JobFilters } from '@/components/jobs/JobFilters';
import { ShortcutsDialog } from '@/components/jobs/ShortcutsDialog';
import { useBoostSet } from '@/components/jobs/TechStackBadges';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { errorMessage, useCvSlots, useJobs, useProfile, useSources, useStats, useUpdateJob } from '@/lib/queries';

const PAGE_SIZE = 30;
/** nell'URL: tutti gli stati tranne gli scartati (senza parametro vale il filtro predefinito "Nuovo") */
const ALL_STATUSES = 'all';

function parseQuery(params: URLSearchParams): JobsQuery {
  const num = (key: string) => (params.get(key) ? Number(params.get(key)) : undefined);
  return {
    q: params.get('q') || undefined,
    // la lista si apre sugli annunci ancora da guardare
    status: params.get('status') === ALL_STATUSES ? undefined : (params.get('status') as JobsQuery['status']) || 'new',
    source: params.get('source') || undefined,
    minScore: num('minScore'),
    contractType: (params.get('contractType') as JobsQuery['contractType']) || undefined,
    vatCompatible: params.get('vatCompatible') === 'true' || undefined,
    includeRejected: params.get('includeRejected') === 'true' || undefined,
    sort: params.get('sort') === 'date' ? 'date' : 'score',
    page: num('page') ?? 1,
    pageSize: PAGE_SIZE,
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.getAttribute('role') === 'combobox' ||
    // menu aperto (es. quello di una tecnologia): i tasti servono a navigarlo, non alle scorciatoie
    target.closest('[role="menu"]') !== null
  );
}

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseQuery(params), [params]);
  const { data: profile } = useProfile();
  const { data, isPending, isError, error, isFetching } = useJobs(query);
  const sources = useSources();
  const stats = useStats();
  const slots = useCvSlots();
  const update = useUpdateJob();
  const boost = useBoostSet(profile?.settings.keywords.boost);

  const jobs = useMemo(() => data?.items ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(params.get('job'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [applyJob, setApplyJob] = useState<JobListItem | null>(null);
  const [askJob, setAskJob] = useState<JobListItem | null>(null);
  const [cvJob, setCvJob] = useState<JobListItem | null>(null);
  const [letterJob, setLetterJob] = useState<JobListItem | null>(null);
  const [manualCvOpen, setManualCvOpen] = useState(false);
  const [interviewJob, setInterviewJob] = useState<JobListItem | null>(null);
  /** candidatura del colloquio proposto in cima alla pagina */
  const [interviewApplicationId, setInterviewApplicationId] = useState<string | null>(null);
  /** annuncio per cui è stato cliccato "Candidati": al ritorno sulla scheda si chiede se la candidatura è partita */
  const pendingApply = useRef<JobListItem | null>(null);

  const setQuery = useCallback(
    (patch: Partial<JobsQuery>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...patch, page: 'page' in patch ? patch.page : 1 };
          for (const [key, value] of Object.entries(merged)) {
            if (key === 'status') {
              if (value === 'new') next.delete(key);
              else next.set(key, value === undefined ? ALL_STATUSES : String(value));
              continue;
            }
            if (
              value === undefined ||
              value === '' ||
              value === false ||
              (key === 'page' && value === 1) ||
              (key === 'sort' && value === 'score')
            ) {
              next.delete(key);
            } else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // disponibilità dell'azione "Genera CV": serve l'LLM attivo e almeno un CV base caricato
  const cvAvailability: CvAvailability = useMemo(() => {
    if (!profile) return { available: false, reason: 'Caricamento…' };
    const { llm } = profile;
    const consentOnly = llm.enabled && llm.external && !profile.settings.scoring.llm.external_consent;
    if (!llm.ready && !consentOnly) {
      return {
        available: false,
        reason: llm.enabled
          ? llm.notReadyReason
          : 'LLM disattivato: attivalo dalla sezione Profilo → Avanzate per generare CV su misura',
      };
    }
    if (slots.data && !slots.data.some((s) => s.status === 'loaded')) {
      return { available: false, reason: 'Nessun CV base caricato: aggiungine uno nella scheda CV del Profilo' };
    }
    return { available: true, reason: null };
  }, [profile, slots.data]);

  useEffect(() => {
    if (jobs.length > 0 && !jobs.some((j) => j.id === selectedId)) setSelectedId(jobs[0]!.id);
  }, [jobs, selectedId]);

  // ritorno sulla scheda dopo "Candidati": "Ti sei candidato?"
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || !pendingApply.current) return;
      const job = pendingApply.current;
      pendingApply.current = null;
      if (job.application) return;
      setAskJob(job);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, []);

  const onApplyClick = useCallback((job: JobListItem) => {
    pendingApply.current = job;
  }, []);

  const toggleStatus = useCallback(
    (job: JobListItem, status: 'saved' | 'discarded') => {
      update.mutate({ id: job.id, patch: { status: job.status === status ? 'new' : status } });
    },
    [update],
  );

  const modalOpen =
    shortcutsOpen ||
    !!applyJob ||
    !!askJob ||
    !!cvJob ||
    !!letterJob ||
    manualCvOpen ||
    !!interviewJob ||
    !!interviewApplicationId ||
    filtersOpen;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || modalOpen) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === '/' && !detailId) {
        event.preventDefault();
        document.getElementById('f-q')?.focus();
        return;
      }
      const index = jobs.findIndex((j) => j.id === selectedId);
      const move = (delta: number) => {
        if (detailId || jobs.length === 0) return;
        const next = jobs[Math.min(jobs.length - 1, Math.max(0, (index === -1 ? 0 : index) + delta))]!;
        setSelectedId(next.id);
        document.getElementById(`job-${next.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const current = jobs.find((j) => j.id === (detailId ?? selectedId));
      switch (event.key.toLowerCase()) {
        case 'j':
          move(1);
          break;
        case 'k':
          move(-1);
          break;
        case 'enter':
          if (!detailId && current && event.target === document.body) setDetailId(current.id);
          break;
        case 's':
          if (current) toggleStatus(current, 'saved');
          break;
        case 'd':
          if (current) toggleStatus(current, 'discarded');
          break;
        case 'a':
          if (current) setApplyJob(current);
          break;
        case 'o':
          if (current) window.open(current.sourceUrl, '_blank', 'noopener,noreferrer');
          break;
        case 'c':
          if (current && cvAvailability.available) setCvJob(current);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobs, selectedId, detailId, modalOpen, toggleStatus, cvAvailability.available]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = query.page ?? 1;
  const activeFilters = countActiveFilters(query);
  const neverFetched = !!stats.data && stats.data.total === 0;
  const fetching = sources.data?.some((s) => s.running) ?? false;

  const filters = (
    <JobFilters
      query={query}
      sources={sources.data ?? []}
      onChange={setQuery}
      onReset={() => setParams(new URLSearchParams(), { replace: true })}
    />
  );

  return (
    <div className="flex">
      <aside
        className="sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r p-4 lg:block"
        aria-label="Filtri"
      >
        <h2 className="mb-4 text-sm font-semibold">Filtri</h2>
        {filters}
      </aside>

      <div className="min-w-0 flex-1 p-4 md:p-6">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">Annunci</h1>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {isPending ? 'Caricamento…' : `${total} ${total === 1 ? 'annuncio' : 'annunci'}`}
              {stats.data?.lastFetchAt ? ` · ultima raccolta ${formatRelative(stats.data.lastFetchAt)}` : ''}
              {fetching ? ' · raccolta in corso…' : ''}
              {isFetching && !isPending ? ' · aggiornamento…' : ''}
            </p>
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                <SlidersHorizontal /> Filtri{activeFilters > 0 ? ` (${activeFilters})` : ''}
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Filtri</SheetTitle>
                <SheetDescription>Restringi la lista degli annunci.</SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-5 pb-6">{filters}</div>
            </SheetContent>
          </Sheet>
          <Button size="sm" onClick={() => setManualCvOpen(true)}>
            <FilePlus2 /> CV da descrizione
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={api.jobs.exportUrl(query)} download>
              <Download /> Esporta CSV
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Scorciatoie da tastiera"
          >
            <Keyboard />
          </Button>
        </header>

        <InterviewSuggestionCard onStart={setInterviewApplicationId} />

        {isPending ? (
          <div className="grid gap-3" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="grid gap-3 rounded-xl border bg-card p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
            {errorMessage(error)}
          </p>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
            {neverFetched ? (
              <Radio className="size-8 text-muted-foreground" />
            ) : (
              <Inbox className="size-8 text-muted-foreground" />
            )}
            <h2 className="font-semibold">
              {neverFetched
                ? fetching
                  ? 'Prima raccolta in corso…'
                  : 'Nessun annuncio raccolto finora'
                : 'Nessun annuncio corrisponde ai filtri'}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {neverFetched
                ? 'La prima raccolta parte da sola dopo l’onboarding e richiede circa un minuto. Puoi seguirne lo stato, o avviarla a mano, dalla pagina Fonti.'
                : 'Prova ad allargare i criteri, a mostrare anche gli annunci scartati dai filtri o a rivedere le keyword nel Profilo.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {neverFetched ? (
                <Button asChild>
                  <Link to="/sources">Vai alle Fonti</Link>
                </Button>
              ) : (
                <>
                  {activeFilters > 0 && (
                    <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                      Azzera filtri
                    </Button>
                  )}
                  {query.status === 'new' && (
                    <Button variant="outline" onClick={() => setQuery({ status: undefined })}>
                      Mostra tutti gli stati
                    </Button>
                  )}
                  {!query.includeRejected && (
                    <Button variant="outline" onClick={() => setQuery({ includeRejected: true })}>
                      Mostra scartati
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3" role="feed" aria-label="Annunci">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={job.id === selectedId}
                  boost={boost}
                  cv={cvAvailability}
                  onSelect={() => setSelectedId(job.id)}
                  onOpen={() => {
                    setSelectedId(job.id);
                    setDetailId(job.id);
                  }}
                  onApplyClick={() => onApplyClick(job)}
                  onGenerateCv={() => setCvJob(job)}
                  onToggleSaved={() => toggleStatus(job, 'saved')}
                  onToggleDiscarded={() => toggleStatus(job, 'discarded')}
                />
              ))}
            </div>
            {pages > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Paginazione">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setQuery({ page: page - 1 })}>
                  Precedente
                </Button>
                <span className="text-sm text-muted-foreground">
                  Pagina {page} di {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => setQuery({ page: page + 1 })}
                >
                  Successiva
                </Button>
              </nav>
            )}
          </>
        )}
      </div>

      <JobDetailSheet
        jobId={detailId}
        boost={boost}
        cv={cvAvailability}
        onClose={() => setDetailId(null)}
        onApplyClick={onApplyClick}
        onMarkApplied={setApplyJob}
        onGenerateCv={setCvJob}
        onGenerateLetter={setLetterJob}
        onStartInterview={setInterviewJob}
      />
      <AskAppliedDialog
        job={askJob}
        onAnswer={(applied) => {
          const job = askJob;
          setAskJob(null);
          if (applied && job) setApplyJob(job);
        }}
      />
      <ApplyDialog job={applyJob} onClose={() => setApplyJob(null)} />
      <GenerateCvDialog job={cvJob} onClose={() => setCvJob(null)} />
      <GenerateLetterDialog job={letterJob} onClose={() => setLetterJob(null)} />
      <ManualCvDialog open={manualCvOpen} onClose={() => setManualCvOpen(false)} />
      <StartInterviewDialog
        target={
          interviewJob
            ? { kind: 'job', id: interviewJob.id }
            : interviewApplicationId
              ? { kind: 'application', id: interviewApplicationId }
              : null
        }
        onClose={() => {
          setInterviewJob(null);
          setInterviewApplicationId(null);
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
