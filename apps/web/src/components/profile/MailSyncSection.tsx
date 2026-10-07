import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Mail, ShieldAlert, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { errorMessage, keys, useMailStatus } from '@/lib/queries';
import { NumberField, SectionCard, SwitchField, TagsField, TextField, type SettingsForm } from './fields';

/**
 * Candidature da Gmail: collegamento dell'account (OAuth, sola lettura) e impostazioni della
 * sincronizzazione periodica. Le credenziali non passano mai da qui: il client OAuth sta in .env,
 * il token in un volume dell'applicazione.
 */
export function MailSyncSection({ form }: { form: SettingsForm }) {
  const client = useQueryClient();
  const status = useMailStatus();
  const data = status.data;

  const connect = useMutation({
    mutationFn: api.mail.startOAuth,
    // la pagina di consenso Google si apre in questa scheda: al termine si torna qui
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disconnect = useMutation({
    mutationFn: api.mail.disconnect,
    onSuccess: () => {
      toast.success('Gmail scollegata');
      void client.invalidateQueries({ queryKey: keys.mailStatus });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SectionCard
      title="Candidature da Gmail"
      description="Legge la tua posta in sola lettura e tiene aggiornato lo storico: le email di conferma diventano candidature, le risposte negative le portano a “Rifiutata”. Le email restano su questo computer: non vengono salvate né inviate ad altri servizi."
    >
      {status.isPending ? (
        <Skeleton className="h-24" />
      ) : !data ? (
        <p className="text-sm text-destructive">{errorMessage(status.error)}</p>
      ) : !data.configured ? (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Manca il client OAuth di Google</AlertTitle>
          <AlertDescription>
            <p>
              Aggiungi <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> al file <code>.env</code>{' '}
              (client di tipo “App desktop”, con la Gmail API attiva) e riavvia l’app. I passaggi sono nella guida
              (docs/GUIDA.md), sezione “Candidature da Gmail”.
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <Mail className="size-5 shrink-0 text-muted-foreground" />
          <div className="mr-auto grid gap-0.5 text-sm">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {data.connected ? (data.account ?? 'Gmail collegata') : 'Gmail non collegata'}
              {data.connected && (
                <Badge variant="success">
                  <CheckCircle2 /> Collegata
                </Badge>
              )}
              {data.needsReconnect && <Badge variant="destructive">Autorizzazione scaduta</Badge>}
            </span>
            <span className="text-xs text-muted-foreground">
              {data.connected
                ? `Sola lettura · collegata il ${formatDateTime(data.connectedAt)}`
                : data.needsReconnect
                  ? 'Google non accetta più l’autorizzazione salvata: collega di nuovo l’account.'
                  : 'Si apre la pagina di Google: scegli l’account e consenti la sola lettura della posta.'}
            </span>
          </div>
          {data.connected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unplug />} Scollega
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
              {connect.isPending && <Loader2 className="animate-spin" />}
              {data.needsReconnect ? 'Ricollega Gmail' : 'Collega Gmail'}
            </Button>
          )}
        </div>
      )}

      {data?.lastRun && (
        <p className="text-sm text-muted-foreground">
          Ultima sincronizzazione {formatRelative(data.lastRun.startedAt)}:{' '}
          {data.lastRun.status === 'error' ? (
            <span className="text-destructive">{data.lastRun.error}</span>
          ) : data.lastRun.status === 'running' ? (
            'in corso…'
          ) : (
            `${data.lastRun.examined} email esaminate, ${data.lastRun.created} candidature nuove, ${data.lastRun.updated} aggiornate.`
          )}
        </p>
      )}

      <SwitchField
        form={form}
        name="mail_sync.enabled"
        label="Aggiorna le candidature in automatico"
        description="A intervalli regolari, finché Gmail resta collegata. Puoi sempre aggiornare a mano dalla pagina Candidature."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          form={form}
          name="mail_sync.interval_minutes"
          label="Intervallo"
          min={15}
          step={15}
          suffix="minuti"
        />
        <NumberField
          form={form}
          name="mail_sync.newer_than_days"
          label="Finestra di ricerca"
          min={1}
          max={365}
          suffix="giorni"
          description="Guarda solo le email più recenti."
        />
        <NumberField
          form={form}
          name="mail_sync.max_messages"
          label="Massimo di email per ricerca"
          min={10}
          max={2000}
          step={10}
        />
      </div>
      <TagsField
        form={form}
        name="mail_sync.ignore_senders"
        label="Mittenti da ignorare"
        placeholder="es. newsletter@esempio.com"
        description="Basta una parte dell’indirizzo: le email di questi mittenti non vengono considerate."
      />
      <TextField
        form={form}
        name="mail_sync.extra_query"
        label="Filtro Gmail aggiuntivo"
        placeholder="es. -label:spam -from:noreply@esempio.com"
        description="Facoltativo: termini di ricerca Gmail aggiunti a entrambe le ricerche (conferme e rifiuti)."
      />
    </SectionCard>
  );
}
