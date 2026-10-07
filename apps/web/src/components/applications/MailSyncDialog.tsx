import type { MailSyncItem, MailSyncRunDto } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { APPLICATION_STATUS_LABEL, formatDate } from '@/lib/format';
import { errorMessage, keys, useMailStatus } from '@/lib/queries';

function Rows({ items, kind }: { items: MailSyncItem[]; kind: 'create' | 'update' }) {
  return (
    <>
      {items.map((item) => (
        <tr
          key={`${kind}-${item.date}-${item.company}-${item.title}-${item.subject}`}
          className="border-b last:border-0"
        >
          <td className="px-2 py-1.5">
            <Badge variant={kind === 'create' ? 'default' : 'warning'}>
              {kind === 'create' ? 'Nuova' : 'Da aggiornare'}
            </Badge>
          </td>
          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{formatDate(item.date)}</td>
          <td className="px-2 py-1.5">{item.company}</td>
          <td className="px-2 py-1.5">{item.title}</td>
          <td className="px-2 py-1.5 whitespace-nowrap">
            {item.previousStatus ? `${APPLICATION_STATUS_LABEL[item.previousStatus]} → ` : ''}
            {APPLICATION_STATUS_LABEL[item.status]}
          </td>
          <td className="max-w-56 truncate px-2 py-1.5 text-muted-foreground" title={item.subject}>
            {item.subject}
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Aggiornamento delle candidature da Gmail: prima l'anteprima di cosa verrebbe creato o aggiornato,
 * poi la conferma. La sincronizzazione automatica fa le stesse cose senza chiedere.
 */
export function MailSyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const status = useMailStatus();
  const connected = !!status.data?.connected;
  const [preview, setPreview] = useState<MailSyncRunDto | null>(null);

  const dryRun = useMutation({
    mutationFn: () => api.mail.sync(true),
    onSuccess: setPreview,
  });
  const apply = useMutation({
    mutationFn: () => api.mail.sync(false),
    onSuccess: (run) => {
      toast.success(`Gmail: ${run.created} candidature nuove, ${run.updated} aggiornate`);
      void client.invalidateQueries({ queryKey: ['applications'] });
      void client.invalidateQueries({ queryKey: keys.mailStatus });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      void client.invalidateQueries({ queryKey: keys.mailStatus });
    },
  });

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    dryRun.reset();
    if (connected) dryRun.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected]);

  const nothingToDo = !!preview && preview.created === 0 && preview.updated === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Aggiorna le candidature da Gmail</DialogTitle>
          <DialogDescription>
            Cerca nella posta le conferme di candidatura e le risposte negative. Le candidature già presenti non vengono
            duplicate e gli stati che hai corretto a mano non vengono sovrascritti.
          </DialogDescription>
        </DialogHeader>

        {status.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Controllo il collegamento…
          </p>
        ) : !connected ? (
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-medium">
              {status.data?.needsReconnect ? 'L’autorizzazione Google è scaduta.' : 'Gmail non è ancora collegata.'}
            </p>
            <p className="mt-1 text-muted-foreground">
              {status.data?.configured === false
                ? 'Serve prima il client OAuth di Google nel file .env: i passaggi sono nel Profilo.'
                : 'Collega l’account dal Profilo: basta una volta.'}
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/profile?tab=fonti">Vai a Profilo → Fonti</Link>
            </Button>
          </div>
        ) : dryRun.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin" /> Leggo la posta… può volerci qualche decina di secondi.
          </p>
        ) : dryRun.isError ? (
          <div role="alert" className="grid gap-3 rounded-lg border border-destructive/50 p-4 text-sm">
            <p className="text-destructive">{errorMessage(dryRun.error)}</p>
            <div>
              <Button variant="outline" size="sm" onClick={() => dryRun.mutate()}>
                <RefreshCw /> Riprova
              </Button>
            </div>
          </div>
        ) : preview ? (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['Email esaminate', preview.examined],
                  ['Nuove', preview.created],
                  ['Da aggiornare', preview.updated],
                  ['Già registrate', preview.duplicates],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            {preview.details.ambiguous.length > 0 && (
              <div
                role="alert"
                className="rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
              >
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4" /> Rifiuti da abbinare a mano
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {preview.details.ambiguous.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {nothingToDo ? (
              <p className="text-sm text-muted-foreground">Niente da fare: lo storico è già aggiornato.</p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      {['Azione', 'Data', 'Azienda', 'Posizione', 'Stato', 'Oggetto della mail'].map((h) => (
                        <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <Rows items={preview.details.updated} kind="update" />
                    <Rows items={preview.details.created} kind="create" />
                  </tbody>
                </table>
              </div>
            )}

            {preview.details.ignored.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {preview.ignored} email scartate (avvisi di offerte, promemoria, inviti…)
                </summary>
                <ul className="mt-2 grid max-h-40 gap-1 overflow-auto text-xs text-muted-foreground">
                  {preview.details.ignored.map((item) => (
                    <li key={`${item.date}-${item.sender}-${item.subject}`}>
                      {formatDate(item.date)} · {item.sender} — {item.subject}{' '}
                      <span className="text-foreground">[{item.reason}]</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {nothingToDo ? 'Chiudi' : 'Annulla'}
          </Button>
          {connected && (
            <Button disabled={!preview || nothingToDo || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending && <Loader2 className="animate-spin" />}
              {nothingToDo ? 'Niente da aggiornare' : 'Aggiorna le candidature'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
