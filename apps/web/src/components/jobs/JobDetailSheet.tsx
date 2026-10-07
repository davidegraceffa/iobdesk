import { JOB_STATUSES, type JobListItem, type JobStatus } from '@jobagg/shared';
import { Ban, CheckCircle2, FileText, Info, Loader2, Mail, MessagesSquare, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate, formatDateTime, JOB_STATUS_LABEL, languageLabel } from '@/lib/format';
import {
  errorMessage,
  useBlockCompany,
  useCvForJob,
  useEstimateSalary,
  useInterviews,
  useJob,
  useLettersForJob,
  useUpdateJob,
} from '@/lib/queries';
import { ApplyActions } from './ApplyActions';
import { JobBadges, type CvAvailability } from './JobCard';
import { CompanyAvatar, JobMetaBadges, SalaryInfo, SourceInfo } from './JobFacts';
import { ScoreBadge } from './ScoreBadge';
import { TechStackBadges } from './TechStackBadges';

interface Props {
  jobId: string | null;
  boost: Set<string>;
  cv: CvAvailability;
  onClose: () => void;
  onApplyClick: (job: JobListItem) => void;
  onMarkApplied: (job: JobListItem) => void;
  onGenerateCv: (job: JobListItem) => void;
  onGenerateLetter: (job: JobListItem) => void;
  onStartInterview: (job: JobListItem) => void;
}

const CONFIDENCE_LABEL = { low: 'bassa', medium: 'media', high: 'alta' } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Dettaglio dell'annuncio: tutte le informazioni obbligatorie, CV e lettere generati, punteggio, stato e note. */
export function JobDetailSheet({
  jobId,
  boost,
  cv,
  onClose,
  onApplyClick,
  onMarkApplied,
  onGenerateCv,
  onGenerateLetter,
  onStartInterview,
}: Props) {
  const { data: job, isPending, isError, error } = useJob(jobId);
  const cvs = useCvForJob(jobId);
  const letters = useLettersForJob(jobId);
  const interviews = useInterviews({ jobId: jobId ?? undefined }, !!jobId);
  const update = useUpdateJob();
  const estimateSalary = useEstimateSalary();
  const blockCompany = useBlockCompany();
  const [notes, setNotes] = useState('');

  useEffect(() => setNotes(job?.notes ?? ''), [job?.id, job?.notes]);

  return (
    <Sheet open={!!jobId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
        {isPending && jobId ? (
          <div className="grid gap-3 p-5">
            <SheetTitle className="sr-only">Caricamento annuncio</SheetTitle>
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError || !job ? (
          <div className="p-5">
            <SheetTitle>Annuncio non disponibile</SheetTitle>
            <p className="mt-2 text-sm text-destructive">{errorMessage(error)}</p>
          </div>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3">
                <CompanyAvatar name={job.company} className="size-10 text-sm" />
                <div className="min-w-0 flex-1">
                  <SheetTitle>{job.title}</SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-foreground">
                    {job.companyUrl ? (
                      <a
                        href={job.companyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:underline"
                      >
                        {job.company}
                      </a>
                    ) : (
                      <span className="font-semibold">{job.company}</span>
                    )}
                  </SheetDescription>
                </div>
                <ScoreBadge score={job.ruleScore} llmScore={job.llmScore} />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <JobBadges job={job} />
              </div>
              <JobMetaBadges job={job} />
            </SheetHeader>

            <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 pb-6">
              {job.rejectedReason && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Scartato dai filtri:</span> {job.rejectedReason}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <ApplyActions job={job} onApplyClick={() => onApplyClick(job)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-disabled={!cv.available}
                      onClick={() => cv.available && onGenerateCv(job)}
                    >
                      <FileText /> Genera CV
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {cv.available ? 'Genera un CV su misura per questo annuncio (c)' : cv.reason}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-disabled={!cv.available}
                      onClick={() => cv.available && onGenerateLetter(job)}
                    >
                      <Mail /> Scrivi lettera
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {cv.available ? 'Scrivi una lettera di candidatura su misura per questo annuncio' : cv.reason}
                  </TooltipContent>
                </Tooltip>
                <Button variant="secondary" size="sm" onClick={() => onStartInterview(job)}>
                  <MessagesSquare /> Simula colloquio
                </Button>
                {!job.application && (
                  <Button variant="outline" size="sm" onClick={() => onMarkApplied(job)}>
                    <CheckCircle2 /> Segna come candidato
                  </Button>
                )}
                {job.application && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/applications?open=${job.application.id}`}>Apri la candidatura</Link>
                  </Button>
                )}
                {job.company.trim() && !job.rejectedReason?.startsWith('Azienda bloccata') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={blockCompany.isPending}
                        onClick={() => blockCompany.block(job.company, onClose)}
                      >
                        <Ban /> Blocca azienda
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Non mostrare più le offerte di {job.company}. Si annulla da Profilo → Criteri di ricerca.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <Separator />

              <SourceInfo job={job} detailed />
              <Section title="RAL / retribuzione">
                <SalaryInfo job={job} />
                {!job.salaryFound && (
                  <div className="grid gap-2">
                    {job.salaryEstimate && (
                      <p className="text-sm text-muted-foreground">
                        {job.salaryEstimate.reasoning}{' '}
                        <span className="text-xs">
                          (mercato: {job.salaryEstimate.market || 'non determinato'} · affidabilità{' '}
                          {CONFIDENCE_LABEL[job.salaryEstimate.confidence]} · {job.salaryEstimate.model} ·{' '}
                          {formatDateTime(job.salaryEstimate.createdAt)})
                        </span>
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={estimateSalary.isPending}
                        onClick={() => estimateSalary.mutate(job.id)}
                      >
                        {estimateSalary.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        {job.salaryEstimate ? 'Rigenera RAL' : 'Genera RAL'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {estimateSalary.isPending
                          ? 'Stima in corso…'
                          : 'Stima dell’LLM per ruolo, seniority e area geografica dell’offerta: non è un dato dell’annuncio.'}
                      </span>
                    </div>
                  </div>
                )}
              </Section>
              <Section title="Stack tecnologico">
                <TechStackBadges techStack={job.techStack} boost={boost} interactive />
              </Section>

              {job.euVatNote && (
                <p className="flex items-start gap-2 rounded-md border border-primary/40 bg-accent p-3 text-sm text-accent-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Fatturazione B2B UE: reverse charge, verifica iscrizione VIES.
                </p>
              )}

              <Section title={`CV generati per questo annuncio (${cvs.data?.length ?? 0})`}>
                {cvs.data && cvs.data.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {cvs.data.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <Link to={`/cv/${c.id}`} className="font-medium text-primary-text hover:underline">
                          Versione {c.version} · {languageLabel(c.language)}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {c.status === 'ready'
                            ? `${c.pageCount ?? '?'} pag.`
                            : c.status === 'failed'
                              ? 'non riuscita'
                              : 'in corso…'}{' '}
                          · {formatDateTime(c.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nessun CV generato per questo annuncio.</p>
                )}
              </Section>

              <Section title={`Lettere di candidatura per questo annuncio (${letters.data?.length ?? 0})`}>
                {letters.data && letters.data.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {letters.data.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <Link to={`/letters/${l.id}`} className="font-medium text-primary-text hover:underline">
                          Versione {l.version} · {languageLabel(l.language)}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {l.status === 'ready'
                            ? l.edited
                              ? 'ritoccata a mano'
                              : 'pronta'
                            : l.status === 'failed'
                              ? 'non riuscita'
                              : 'in corso…'}{' '}
                          · {formatDateTime(l.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nessuna lettera scritta per questo annuncio.</p>
                )}
              </Section>

              {interviews.data && interviews.data.length > 0 && (
                <Section title={`Colloqui simulati (${interviews.data.length})`}>
                  <ul className="grid gap-1 text-sm">
                    {interviews.data.map((iv) => (
                      <li key={iv.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <Link to={`/interviews/${iv.id}`} className="font-medium text-primary-text hover:underline">
                          Tentativo {iv.attempt} · {formatDateTime(iv.createdAt)} · {languageLabel(iv.language)}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {iv.answeredCount}/{iv.questionCount} risposte
                          {iv.averageScore !== null ? ` · media ${iv.averageScore}/5` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Scomposizione del punteggio">
                <table className="w-full text-sm">
                  <tbody>
                    {job.scoreBreakdown.items.map((item) => (
                      <tr key={item.key} className="border-b last:border-0">
                        <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                          {item.label}
                        </th>
                        <td className="py-1.5 pr-2 text-muted-foreground">{item.detail}</td>
                        <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                          {item.max > 0 ? `${item.points} / ${item.max}` : item.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="pt-2 text-left">
                        Totale
                      </th>
                      <td />
                      <td className="pt-2 text-right font-semibold tabular-nums">{job.ruleScore} / 100</td>
                    </tr>
                  </tfoot>
                </table>
              </Section>

              {(job.llmReason || job.llmScore !== null) && (
                <Section title="Valutazione LLM">
                  <p className="flex items-start gap-2 text-sm">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="font-medium">{job.llmScore}/100.</span> {job.llmReason}
                    </span>
                  </p>
                  {job.llmRedFlags.length > 0 && (
                    <ul className="list-disc pl-9 text-sm text-muted-foreground">
                      {job.llmRedFlags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                <div className="grid content-start gap-2">
                  <Label htmlFor="jd-status">Stato</Label>
                  <Select
                    value={job.status}
                    onValueChange={(status) => update.mutate({ id: job.id, patch: { status: status as JobStatus } })}
                  >
                    <SelectTrigger id="jd-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {JOB_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="jd-notes">Note</Label>
                  <Textarea
                    id="jd-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => {
                      if (notes !== (job.notes ?? '')) update.mutate({ id: job.id, patch: { notes } });
                    }}
                    placeholder="Appunti personali su questo annuncio (salvati quando esci dal campo)"
                  />
                </div>
              </div>

              <Separator />

              <Section title="Descrizione originale">
                <p className="text-xs text-muted-foreground">
                  Testo integrale come pubblicato dalla fonte, senza riassunti né traduzioni. Pubblicato il{' '}
                  {formatDate(job.publishedAt)} · visto l’ultima volta il {formatDate(job.lastSeenAt)} · lingua
                  rilevata: {languageLabel(job.language)}
                </p>
                {job.descriptionHtml ? (
                  // HTML sanitizzato lato API (nessuno script, stile o attributo attivo)
                  <div className="job-description" dangerouslySetInnerHTML={{ __html: job.descriptionHtml }} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    La fonte non fornisce la descrizione: aprila dall’annuncio originale.
                  </p>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
