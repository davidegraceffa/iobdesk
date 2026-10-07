import { CalendarDays, MapPin, MessagesSquare, Shuffle, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { APPLICATION_STATUS_LABEL, formatDate, formatRelative, languageLabel, todayIso } from '@/lib/format';
import { useInterviewSuggestion } from '@/lib/queries';

const DISMISSED_KEY = 'interview-suggestion-dismissed';

function dismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === todayIso();
  } catch {
    return false;
  }
}

/**
 * Colloquio proposto in cima agli annunci: una candidatura passata scelta a caso su cui esercitarsi.
 * Ha un colore in evidenza per farsi notare; chiusa, non ricompare fino al giorno dopo.
 */
export function InterviewSuggestionCard({ onStart }: { onStart: (applicationId: string) => void }) {
  const [dismissed, setDismissed] = useState(dismissedToday);
  const [pick, setPick] = useState<{ draw: number; exclude?: string }>({ draw: 0 });
  const { data: suggestion, isFetching } = useInterviewSuggestion(pick, !dismissed);

  if (dismissed || !suggestion) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, todayIso());
    } catch {
      // senza localStorage la chiusura vale solo per questa visita
    }
    setDismissed(true);
  };

  const history =
    suggestion.previousAttempts === 0
      ? 'Non ti sei ancora esercitato su questa posizione.'
      : `${suggestion.previousAttempts} ${suggestion.previousAttempts === 1 ? 'colloquio simulato' : 'colloqui simulati'} finora, l’ultimo ${formatRelative(suggestion.lastInterviewAt)}${
          suggestion.lastOverallScore !== null ? ` (voto ${suggestion.lastOverallScore}/5)` : ''
        }.`;

  return (
    <section
      aria-label="Colloquio proposto"
      className="relative mb-4 grid gap-3 rounded-xl bg-highlight p-4 pr-12 text-highlight-foreground shadow-sm"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 text-highlight-foreground hover:bg-highlight-foreground/15 hover:text-highlight-foreground"
        onClick={dismiss}
        aria-label="Chiudi la proposta di colloquio (ricompare domani)"
        title="Chiudi: ricompare domani"
      >
        <X />
      </Button>

      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
        <MessagesSquare className="size-4" aria-hidden="true" />
        Colloquio proposto per oggi
      </p>

      <div className="min-w-0">
        <h2 className="text-lg leading-snug font-semibold">
          {suggestion.title} <span className="font-normal">· {suggestion.company}</span>
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-4" aria-hidden="true" />
            Candidatura del {formatDate(suggestion.appliedAt)} · {APPLICATION_STATUS_LABEL[suggestion.currentStatus]}
          </span>
          {suggestion.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-4" aria-hidden="true" />
              {suggestion.location}
            </span>
          )}
          {suggestion.language && <span>Colloquio in {languageLabel(suggestion.language).toLowerCase()}</span>}
        </p>
      </div>

      {suggestion.techStack.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tecnologie dell’annuncio">
          {suggestion.techStack.map((tech) => (
            <li
              key={tech}
              className="rounded-full border border-highlight-foreground/40 px-2 py-0.5 text-xs font-medium"
            >
              {tech}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">{history}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="bg-highlight-foreground text-highlight hover:bg-highlight-foreground/90"
          onClick={() => onStart(suggestion.applicationId)}
        >
          <MessagesSquare /> Simula il colloquio
        </Button>
        {suggestion.alternatives > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-highlight-foreground hover:bg-highlight-foreground/15 hover:text-highlight-foreground"
            disabled={isFetching}
            onClick={() => setPick((p) => ({ draw: p.draw + 1, exclude: suggestion.applicationId }))}
          >
            <Shuffle /> Proponine un altro
          </Button>
        )}
        <Link
          to={`/applications?open=${suggestion.applicationId}`}
          className="text-sm font-medium underline underline-offset-4"
        >
          Apri la candidatura
        </Link>
      </div>
    </section>
  );
}
