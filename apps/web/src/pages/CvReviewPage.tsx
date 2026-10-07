import type { GeneratedCvDetail } from '@jobagg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Columns2,
  Download,
  FileText,
  Link2,
  Mail,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CoveragePanel } from '@/components/cv/CoveragePanel';
import { EditsPanel } from '@/components/cv/EditsPanel';
import { EmailPanel } from '@/components/cv/EmailPanel';
import { GenerationProgress } from '@/components/cv/GenerationProgress';
import { ApplyDialog } from '@/components/jobs/ApplyDialog';
import { GenerateCvDialog } from '@/components/jobs/GenerateCvDialog';
import { GenerateLetterDialog } from '@/components/jobs/GenerateLetterDialog';
import { ManualCvDialog } from '@/components/jobs/ManualCvDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type EditChange } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys, useJob, useUpdateApplication } from '@/lib/queries';
import { useCvProgress } from '@/lib/useCvProgress';
import { cn } from '@/lib/utils';
import { PageSkeleton } from '../App';

const PdfViewer = lazy(() => import('@/components/cv/PdfViewer'));

function describeRejected(edit: unknown): string {
  const e = (edit ?? {}) as { op?: string; newText?: string; paragraphId?: string };
  if (e.newText) return `“${e.newText.slice(0, 160)}${e.newText.length > 160 ? '…' : ''}”`;
  return `${e.op ?? 'modifica'}${e.paragraphId ? ` su ${e.paragraphId}` : ''}`;
}

/** Pagina "CV per [Ruolo] – [Azienda]": anteprima PDF, modifiche con diff, copertura requisiti, download. */
export function CvReviewPage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const {
    data: cv,
    isPending,
    isError,
    error,
  } = useQuery({ queryKey: keys.cvDetail(id), queryFn: () => api.cv.detail(id), enabled: !!id });
  const inProgress = cv?.status === 'queued' || cv?.status === 'running';
  const progress = useCvProgress(inProgress ? id : null);
  const job = useJob(cv?.jobId ?? null);
  const updateApplication = useUpdateApplication();
  const [sideBySide, setSideBySide] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  /** cambia a ogni rigenerazione dei file: forza il ricaricamento di PDF e miniature */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (progress?.step === 'ready' || progress?.step === 'failed')
      void client.invalidateQueries({ queryKey: keys.cvDetail(id) });
  }, [progress?.step, client, id]);

  const patch = useMutation({
    mutationFn: (change: EditChange) => api.cv.patchEdits(id, [change]),
    onSuccess: (detail: GeneratedCvDetail) => {
      client.setQueryData(keys.cvDetail(id), detail);
      setRevision((r) => r + 1);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) return <PageSkeleton />;
  if (isError || !cv) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/">
            <ArrowLeft /> Torna agli annunci
          </Link>
        </Button>
      </div>
    );
  }

  const version = `${cv.id}-${revision}-${cv.pageCount ?? 0}`;
  const overPages = cv.pageCount !== null && cv.basePageCount > 0 && cv.pageCount > cv.basePageCount;
  const jobApplication = job.data?.application ?? null;

  const useForApplication = () => {
    if (jobApplication) {
      // la candidatura esiste già: le si collega questo CV
      updateApplication.mutate(
        { id: jobApplication.id, patch: { generatedCvId: cv.id } },
        { onSuccess: () => toast.success('CV collegato alla candidatura') },
      );
    } else setApplyOpen(true);
  };

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 grid gap-3">
        <Link
          to={cv.jobId ? `/?job=${cv.jobId}` : '/'}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary-text hover:underline"
        >
          <ArrowLeft className="size-4" /> {cv.jobId ? 'Torna all’annuncio' : 'Torna agli annunci'}
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold">
              CV per {cv.jobTitle} – {cv.company}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge variant="secondary">{languageLabel(cv.language)}</Badge>
              <Badge variant="secondary">Versione {cv.version}</Badge>
              {cv.pageCount !== null && (
                <Badge variant={overPages ? 'destructive' : 'success'}>
                  {cv.pageCount} {cv.pageCount === 1 ? 'pagina' : 'pagine'} (CV base: {cv.basePageCount})
                </Badge>
              )}
              <span>
                {cv.provider} · {cv.model} · {formatDateTime(cv.createdAt)}
              </span>
              {cv.manual ? (
                <span>· da descrizione incollata</span>
              ) : (
                !cv.jobId && <span>· l’annuncio non esiste più</span>
              )}
            </p>
          </div>
          {cv.status === 'ready' && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={api.cv.pdfDownloadUrl(cv.id)} download={`${cv.fileName}.pdf`}>
                  <Download /> Scarica PDF
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={api.cv.docxUrl(cv.id)} download={`${cv.fileName}.docx`}>
                  <Download /> Scarica DOCX
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!cv.jobId && !cv.manual}
                onClick={() => setRegenerate(true)}
              >
                <RefreshCw /> Rigenera
              </Button>
              <Button variant="outline" size="sm" disabled={!cv.jobId} onClick={() => setLetterOpen(true)}>
                <Mail /> Scrivi lettera
              </Button>
              {cv.applicationId ? (
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/applications?open=${cv.applicationId}`}>
                    <CheckCircle2 /> Usato per la candidatura
                  </Link>
                </Button>
              ) : (
                <Button size="sm" disabled={!cv.jobId || updateApplication.isPending} onClick={useForApplication}>
                  <Link2 /> Usa per la candidatura
                </Button>
              )}
            </div>
          )}
        </div>
        {cv.userInstructions && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Istruzioni:</span> {cv.userInstructions}
          </p>
        )}
      </header>

      {inProgress ? (
        <div className="mx-auto max-w-lg rounded-xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Generazione in corso</h2>
          <GenerationProgress event={progress ?? { generatedCvId: cv.id, step: cv.step }} />
        </div>
      ) : cv.status === 'failed' ? (
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertTriangle />
          <AlertTitle>Generazione non riuscita</AlertTitle>
          <AlertDescription>
            <p>{cv.error ?? 'Errore sconosciuto'}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-fit"
              disabled={!cv.jobId && !cv.manual}
              onClick={() => setRegenerate(true)}
            >
              <RefreshCw /> Riprova
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
          <section aria-label="Anteprima" className="grid content-start gap-3">
            {cv.warning && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Da controllare</AlertTitle>
                <AlertDescription>{cv.warning}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={sideBySide ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={sideBySide}
                onClick={() => setSideBySide((v) => !v)}
              >
                <Columns2 /> Affianca il CV base
              </Button>
              {cv.pageCount !== null && cv.pageCount > 0 && (
                <ul className="ml-auto flex gap-2" aria-label="Miniature delle pagine">
                  {Array.from({ length: Math.min(cv.pageCount, 4) }, (_, i) => (
                    <li key={i}>
                      <img
                        src={api.cv.thumbnailUrl(cv.id, i + 1, version)}
                        alt={`Miniatura pagina ${i + 1}`}
                        loading="lazy"
                        className="h-16 w-auto rounded border bg-white shadow-xs"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Suspense fallback={<Skeleton className="h-[70dvh]" />}>
              <div className={cn('grid gap-3', sideBySide && 'lg:grid-cols-2')}>
                {sideBySide && <PdfViewer url={api.cv.basePdfUrl(cv.baseCvId)} title="CV base" className="h-[75dvh]" />}
                <PdfViewer url={api.cv.pdfUrl(cv.id, version)} title="CV generato" className="h-[75dvh]" />
              </div>
            </Suspense>
          </section>

          <section aria-label="Revisione" className="min-w-0">
            {cv.rejectedEdits.length > 0 && (
              <Alert variant="warning" className="mb-3">
                <ShieldAlert />
                <AlertTitle>
                  {cv.rejectedEdits.length} {cv.rejectedEdits.length === 1 ? 'modifica scartata' : 'modifiche scartate'}{' '}
                  dal controllo anti-invenzione
                </AlertTitle>
                <AlertDescription>
                  <p>
                    Non sono state applicate perché avrebbero aggiunto contenuti assenti dal tuo CV o non verificabili.
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer font-medium">Mostra il dettaglio</summary>
                    <ul className="mt-2 grid gap-2">
                      {cv.rejectedEdits.map((r, i) => (
                        <li key={i} className="rounded-md border border-current/20 p-2">
                          <span className="font-medium">{r.reason}</span>
                          <span className="block text-xs opacity-80">{describeRejected(r.edit)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="edits">
              <TabsList>
                <TabsTrigger value="edits">
                  <FileText /> Modifiche ({cv.edits.length})
                </TabsTrigger>
                <TabsTrigger value="coverage">Copertura requisiti</TabsTrigger>
                <TabsTrigger value="email">
                  <Mail /> Email
                </TabsTrigger>
              </TabsList>
              <TabsContent value="edits">
                <EditsPanel cv={cv} busy={patch.isPending} onChange={(change) => patch.mutate(change)} />
              </TabsContent>
              <TabsContent value="coverage">
                <CoveragePanel cv={cv} />
              </TabsContent>
              <TabsContent value="email">
                <EmailPanel cv={cv} />
              </TabsContent>
            </Tabs>
          </section>
        </div>
      )}

      <GenerateCvDialog
        job={regenerate && cv.jobId ? { id: cv.jobId, title: cv.jobTitle, company: cv.company } : null}
        regenerateFrom={{ id: cv.id, language: cv.language, instructions: cv.userInstructions }}
        onClose={() => setRegenerate(false)}
      />
      <ManualCvDialog
        open={regenerate && cv.manual}
        initial={{
          title: cv.jobTitle,
          company: cv.company,
          description: cv.descriptionText ?? '',
          language: cv.language,
          instructions: cv.userInstructions,
        }}
        onClose={() => setRegenerate(false)}
      />
      <GenerateLetterDialog
        job={letterOpen && cv.jobId ? { id: cv.jobId, title: cv.jobTitle, company: cv.company } : null}
        onClose={() => setLetterOpen(false)}
      />
      <ApplyDialog
        job={applyOpen && job.data ? job.data : null}
        presetCvId={cv.id}
        onClose={() => setApplyOpen(false)}
      />
    </div>
  );
}
