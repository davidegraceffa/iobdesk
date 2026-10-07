import { AlertTriangle, MailCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatRelative } from '@/lib/format';
import { useMailStatus } from '@/lib/queries';

/**
 * Esito dell'ultima sincronizzazione con Gmail, mostrato solo quando serve un intervento:
 * autorizzazione scaduta, errore, rifiuti che non si è riusciti ad abbinare a una candidatura.
 * Altrimenti una riga discreta con le ultime novità.
 */
export function MailSyncNotice({ onOpen }: { onOpen: (applicationId: string) => void }) {
  const { data } = useMailStatus();
  if (!data || (!data.connected && !data.needsReconnect)) return null;
  const run = data.lastRun;

  if (data.needsReconnect) {
    return (
      <Alert variant="warning" className="mb-4">
        <AlertTriangle />
        <AlertTitle>L’autorizzazione a Gmail è scaduta</AlertTitle>
        <AlertDescription>
          <p>
            Le candidature non vengono più aggiornate dalle email.{' '}
            <Link to="/profile?tab=fonti" className="font-medium underline">
              Ricollega Gmail dal Profilo
            </Link>
            .
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (!run) return null;

  if (run.status === 'error') {
    return (
      <Alert variant="warning" className="mb-4">
        <AlertTriangle />
        <AlertTitle>L’ultima sincronizzazione con Gmail non è riuscita</AlertTitle>
        <AlertDescription>
          <p>
            {formatRelative(run.startedAt)}: {run.error}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const changed = [...run.details.updated, ...run.details.created].filter((item) => item.applicationId);
  if (run.details.ambiguous.length === 0 && changed.length === 0) return null;

  return (
    <Alert variant={run.details.ambiguous.length > 0 ? 'warning' : 'default'} className="mb-4">
      {run.details.ambiguous.length > 0 ? <AlertTriangle /> : <MailCheck />}
      <AlertTitle>
        Gmail, {formatRelative(run.startedAt)}: {run.created} candidature nuove, {run.updated} aggiornate
      </AlertTitle>
      <AlertDescription>
        {changed.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            {changed.slice(0, 8).map((item) => (
              <li key={item.applicationId}>
                <button
                  type="button"
                  className="rounded-sm text-left underline-offset-2 hover:underline"
                  onClick={() => onOpen(item.applicationId!)}
                >
                  {item.company} — {item.title}
                  {item.status === 'rejected' ? ' (rifiutata)' : ''}
                </button>
              </li>
            ))}
            {changed.length > 8 && <li className="text-muted-foreground">e altre {changed.length - 8}</li>}
          </ul>
        )}
        {run.details.ambiguous.length > 0 && (
          <ul className="mt-1 grid gap-0.5">
            {run.details.ambiguous.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
