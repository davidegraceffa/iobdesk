import type { CvProgressEvent } from '@jobagg/shared';
import { Check, Circle, Loader2, XCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { CV_STEPS, stepIndex } from '@/lib/useCvProgress';
import { cn } from '@/lib/utils';

/** Avanzamento della generazione: analisi annuncio → adattamento contenuti → impaginazione → anteprima. */
export function GenerationProgress({ event }: { event: CvProgressEvent | null }) {
  const current = event ? stepIndex(event.step) : 0;
  const failed = event?.step === 'failed';
  const percent = failed ? 100 : Math.round((Math.max(current, 0) / 5) * 100);
  return (
    <div className="grid gap-4" aria-live="polite">
      <Progress value={percent} aria-label="Avanzamento della generazione" />
      <ol className="grid gap-2">
        {CV_STEPS.map(({ step, label }) => {
          const index = stepIndex(step);
          const done = !failed && current > index;
          const active = !failed && current === index;
          return (
            <li
              key={step}
              className={cn('flex items-center gap-2 text-sm', !done && !active && 'text-muted-foreground')}
            >
              {done ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : active ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Circle className="size-4 opacity-40" aria-hidden="true" />
              )}
              <span className={cn(active && 'font-medium')}>{label}</span>
              <span className="sr-only">{done ? ' (completato)' : active ? ' (in corso)' : ''}</span>
            </li>
          );
        })}
      </ol>
      {(!event || event.step === 'queued') && <p className="text-sm text-muted-foreground">In coda…</p>}
      {failed && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span>Generazione non riuscita: {event?.message ?? 'errore sconosciuto'}</span>
        </p>
      )}
    </div>
  );
}
