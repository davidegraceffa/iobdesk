import { APPLICATION_STATUSES, type ApplicationStatus, type ContractType } from '@jobagg/shared';
import { BellRing, ExternalLink, FileText, MessagesSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StartInterviewDialog } from '@/components/interview/StartInterviewDialog';
import { SalaryInfo } from '@/components/jobs/JobFacts';
import { TechStackBadges } from '@/components/jobs/TechStackBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  APPLICATION_STATUS_LABEL,
  CHANNEL_LABEL,
  CONTRACT_LABEL,
  formatDate,
  formatDateTime,
  languageLabel,
} from '@/lib/format';
import { errorMessage, useApplication, useInterviews, useUpdateApplication } from '@/lib/queries';

const NO_BOOST = new Set<string>();

/**
 * Dettaglio di una candidatura: snapshot dell'annuncio (consultabile anche se l'annuncio
 * non esiste più), timeline degli eventi e aggiornamenti.
 */
export function ApplicationDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: app, isPending, isError, error } = useApplication(id);
  const update = useUpdateApplication();
  const interviews = useInterviews({ applicationId: id ?? undefined }, !!id);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [country, setCountry] = useState('');
  const [cvSent, setCvSent] = useState('');
  const [cvLanguage, setCvLanguage] = useState('');
  const [salary, setSalary] = useState('');

  useEffect(() => {
    setNote('');
    setNotes(app?.notes ?? '');
    setContactName(app?.contactName ?? '');
    setContactEmail(app?.contactEmail ?? '');
    setCountry(app?.country ?? '');
    setCvSent(app?.cvSent ?? '');
    setCvLanguage(app?.cvLanguage ?? '');
    setSalary(app?.snapshot.salaryFound ? (app.snapshot.salaryRawText ?? '') : '');
  }, [
    app?.id,
    app?.notes,
    app?.contactName,
    app?.contactEmail,
    app?.country,
    app?.cvSent,
    app?.cvLanguage,
    app?.snapshot.salaryFound,
    app?.snapshot.salaryRawText,
  ]);

  const snapshot = app?.snapshot;
  const isMailLink = /^https:\/\/mail\.google\.com\//.test(snapshot?.applyUrl || snapshot?.sourceUrl || '');
  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
        {isPending && id ? (
          <div className="grid gap-3 p-5">
            <SheetTitle className="sr-only">Caricamento candidatura</SheetTitle>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError || !app || !snapshot ? (
          <div className="p-5">
            <SheetTitle>Candidatura non disponibile</SheetTitle>
            <p className="mt-2 text-sm text-destructive">{errorMessage(error)}</p>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{snapshot.title}</SheetTitle>
              <SheetDescription className="text-sm text-foreground">
                <span className="font-medium">{snapshot.company}</span>
                <span className="text-muted-foreground">
                  {' · '}candidatura del {formatDate(app.appliedAt)} · {CHANNEL_LABEL[app.channel]} · fonte:{' '}
                  {snapshot.sourceName ?? snapshot.source}
                </span>
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary">{APPLICATION_STATUS_LABEL[app.currentStatus]}</Badge>
                {app.externalId ? (
                  <Badge variant="muted" title={`ID nel file: ${app.externalId}`}>
                    Importata da file{app.trackingMode ? ` · ${app.trackingMode}` : ''}
                  </Badge>
                ) : (
                  !app.jobId && <Badge variant="muted">Annuncio non più disponibile: resta la copia salvata</Badge>
                )}
                {app.country && <Badge variant="outline">{app.country}</Badge>}
                {app.needsFollowUp && (
                  <Badge variant="warning">
                    <BellRing /> Nessuna risposta da {app.daysSinceLastActivity} giorni
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 pb-6">
              {app.needsFollowUp && (
                <p className="rounded-md border border-warning-border bg-warning text-warning-foreground p-3 text-sm">
                  Suggerimento: è passato un po’ dall’ultima attività. Un breve messaggio di follow-up al recruiter
                  {app.contactName ? ` (${app.contactName})` : ''} può sbloccare la situazione; poi registra qui
                  l’aggiornamento.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {(snapshot.applyUrl || snapshot.sourceUrl) && (
                  <Button asChild variant="outline" size="sm">
                    <a href={snapshot.applyUrl || snapshot.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> {isMailLink ? 'Apri l’email di conferma' : 'Link dell’annuncio'}
                    </a>
                  </Button>
                )}
                {app.generatedCvId && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/cv/${app.generatedCvId}`}>
                      <FileText /> CV inviato
                    </Link>
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setInterviewOpen(true)}>
                  <MessagesSquare /> Simula colloquio
                </Button>
              </div>

              {interviews.data && interviews.data.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">Colloqui simulati ({interviews.data.length})</h3>
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
                </section>
              )}

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Aggiorna</h3>
                <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                  <div className="grid content-start gap-2">
                    <Label htmlFor="ad-status">Stato</Label>
                    <Select
                      value={app.currentStatus}
                      onValueChange={(status) =>
                        update.mutate(
                          {
                            id: app.id,
                            patch: { currentStatus: status as ApplicationStatus, eventNote: note.trim() || undefined },
                          },
                          { onSuccess: () => setNote('') },
                        )
                      }
                    >
                      <SelectTrigger id="ad-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPLICATION_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {APPLICATION_STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!note.trim()) return;
                      update.mutate(
                        { id: app.id, patch: { eventNote: note.trim() } },
                        { onSuccess: () => setNote('') },
                      );
                    }}
                  >
                    <Label htmlFor="ad-note">Aggiornamento per la timeline</Label>
                    <div className="flex gap-2">
                      <Input
                        id="ad-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Es. colloquio tecnico fissato per giovedì"
                        maxLength={2000}
                      />
                      <Button type="submit" variant="secondary" disabled={!note.trim() || update.isPending}>
                        Aggiungi
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Se cambi lo stato, il testo scritto qui viene salvato insieme al cambio.
                    </p>
                  </form>
                </div>
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Timeline</h3>
                <ol className="relative grid gap-3 border-l pl-4">
                  {(app.events ?? []).map((event) => (
                    <li key={event.id} className="relative text-sm">
                      <span
                        className="absolute top-1.5 -left-[1.31rem] size-2.5 rounded-full border-2 border-background bg-primary"
                        aria-hidden="true"
                      />
                      <div className="font-medium">
                        {event.fromStatus && event.fromStatus !== event.toStatus
                          ? `${APPLICATION_STATUS_LABEL[event.fromStatus as ApplicationStatus] ?? event.fromStatus} → ${APPLICATION_STATUS_LABEL[event.toStatus as ApplicationStatus] ?? event.toStatus}`
                          : event.fromStatus
                            ? 'Aggiornamento'
                            : (APPLICATION_STATUS_LABEL[event.toStatus as ApplicationStatus] ?? event.toStatus)}
                      </div>
                      {event.note && <p className="text-muted-foreground">{event.note}</p>}
                      <time className="text-xs text-muted-foreground" dateTime={event.at}>
                        {formatDateTime(event.at)}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Dettagli, contatto e note</h3>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate({
                      id: app.id,
                      patch: { notes, contactName, contactEmail, country, cvSent, cvLanguage, salaryRawText: salary },
                    });
                  }}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="ad-contact">Contatto</Label>
                    <Input id="ad-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ad-email">Email</Label>
                    <Input
                      id="ad-email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ad-country">Nazione</Label>
                    <Input
                      id="ad-country"
                      value={country}
                      maxLength={100}
                      onChange={(e) => setCountry(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <div className="grid gap-2">
                      <Label htmlFor="ad-cv">CV inviato</Label>
                      <Input
                        id="ad-cv"
                        value={cvSent}
                        maxLength={200}
                        placeholder={app.generatedCvId ? 'CV su misura (vedi sopra)' : 'Es. CV_inglese.pdf'}
                        onChange={(e) => setCvSent(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ad-cvlang">Lingua</Label>
                      <Input
                        id="ad-cvlang"
                        value={cvLanguage}
                        maxLength={40}
                        onChange={(e) => setCvLanguage(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="ad-salary">RAL / retribuzione</Label>
                    <Input
                      id="ad-salary"
                      value={salary}
                      maxLength={200}
                      placeholder="Es. 45.000 € lordi, 40-50k EUR, 350 €/giorno"
                      onChange={(e) => setSalary(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Testo libero: compare nella colonna RAL e nell’export. Lascia vuoto se non è nota.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="ad-notes">Note</Label>
                    <Textarea id="ad-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="secondary" size="sm" disabled={update.isPending}>
                      Salva dettagli e note
                    </Button>
                  </div>
                </form>
              </section>

              <Separator />

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Annuncio al momento della candidatura</h3>
                <p className="text-sm text-muted-foreground">
                  {snapshot.location || 'Località non indicata'} ·{' '}
                  {CONTRACT_LABEL[snapshot.contractType as ContractType] ?? snapshot.contractType}
                </p>
                <SalaryInfo
                  job={{
                    salaryFound: snapshot.salaryFound,
                    salaryRawText: snapshot.salaryRawText ?? null,
                    salaryLocalMin: null,
                    salaryLocalMax: null,
                    localCurrency: null,
                    salaryPeriod: snapshot.salaryPeriod ?? null,
                    salaryCurrency: null,
                  }}
                />
                <TechStackBadges techStack={snapshot.techStack} boost={NO_BOOST} />
                {snapshot.descriptionHtml ? (
                  <div className="job-description" dangerouslySetInnerHTML={{ __html: snapshot.descriptionHtml }} />
                ) : snapshot.descriptionOriginal ? (
                  <p className="text-sm whitespace-pre-wrap">{snapshot.descriptionOriginal}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Descrizione non salvata.</p>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
      <StartInterviewDialog
        target={interviewOpen && app ? { kind: 'application', id: app.id } : null}
        onClose={() => setInterviewOpen(false)}
      />
    </Sheet>
  );
}
