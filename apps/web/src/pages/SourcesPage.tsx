import type { SourceStatusDto } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { errorMessage, keys, useSources } from '@/lib/queries';

function StatusCell({ source }: { source: SourceStatusDto }) {
  if (source.running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Loader2 className="size-4 animate-spin" /> Raccolta in corso
      </span>
    );
  }
  if (!source.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <MinusCircle className="size-4" /> Disattivata
      </span>
    );
  }
  if (!source.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <AlertTriangle className="size-4" /> Credenziali mancanti in .env
      </span>
    );
  }
  if (source.lastRun?.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <AlertTriangle className="size-4" /> Errore
      </span>
    );
  }
  if (source.lastSuccessAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <CheckCircle2 className="size-4 text-success" /> Attiva
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">In attesa della prima raccolta</span>;
}

/** Pagina Fonti: stato, ultimo run, errori, rilevanza per il paese dell'utente, raccolta manuale. */
export function SourcesPage() {
  const client = useQueryClient();
  const { data: sources, isPending, isError, error } = useSources();
  const fetchNow = useMutation({
    mutationFn: (source?: string) => api.sources.fetch(source),
    onSuccess: (_result, source) => {
      toast.success(source ? 'Raccolta avviata' : 'Raccolta avviata per tutte le fonti abilitate');
      void client.invalidateQueries({ queryKey: keys.sources });
      setTimeout(() => void client.invalidateQueries({ queryKey: ['jobs'] }), 8000);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const anyRunning = sources?.some((s) => s.running) ?? false;

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Fonti</h1>
          <p className="text-sm text-muted-foreground">
            Solo API pubbliche, endpoint JSON e feed RSS. Abilitazione e intervalli si cambiano dal{' '}
            <Link to="/profile?tab=fonti" className="text-primary-text underline underline-offset-2">
              Profilo
            </Link>
            .
          </p>
        </div>
        <Button onClick={() => fetchNow.mutate(undefined)} disabled={fetchNow.isPending || anyRunning}>
          <RefreshCw className={anyRunning ? 'animate-spin' : undefined} /> Aggiorna tutte
        </Button>
      </header>

      {isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Ultima raccolta</TableHead>
                <TableHead>Rilevanza</TableHead>
                <TableHead className="text-right">Annunci</TableHead>
                <TableHead>Intervallo</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => {
                const run = source.lastRun;
                return (
                  <TableRow key={source.id}>
                    <TableCell className="max-w-64">
                      <div className="font-medium">
                        {source.homepage ? (
                          <a
                            href={source.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {source.displayName}
                          </a>
                        ) : (
                          source.displayName
                        )}
                      </div>
                      {source.attribution && <div className="text-xs text-muted-foreground">{source.attribution}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusCell source={source} />
                    </TableCell>
                    <TableCell className="max-w-80">
                      {run ? (
                        <div className="grid gap-0.5 text-sm">
                          <span title={new Date(run.startedAt).toLocaleString('it-IT')}>
                            {formatRelative(run.startedAt)}
                          </span>
                          {run.status === 'error' ? (
                            <span className="text-xs break-words whitespace-normal text-destructive">{run.error}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {run.found} trovati · {run.created} nuovi · {run.duplicates} duplicati · {run.rejected}{' '}
                              scartati
                            </span>
                          )}
                          {run.message && (
                            <span className="text-xs whitespace-normal text-muted-foreground">{run.message}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Mai eseguita</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {source.relevant ? (
                        <Badge variant="success">Consigliata per il tuo paese</Badge>
                      ) : (
                        <Badge variant="muted">Poco rilevante</Badge>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">{source.relevantRegions.join(', ')}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{source.jobCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      ogni {source.intervalMinutes} min
                      {source.intervalMinutes === source.minIntervalMinutes && (
                        <div className="text-xs">minimo imposto dalla fonte</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!source.enabled || !source.configured || source.running || fetchNow.isPending}
                        onClick={() => fetchNow.mutate(source.id)}
                        aria-label={`Aggiorna ${source.displayName}`}
                      >
                        <RefreshCw className={source.running ? 'animate-spin' : undefined} /> Aggiorna
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
