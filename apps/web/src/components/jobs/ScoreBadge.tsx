import { scoreBand } from '@/lib/format';
import { cn } from '@/lib/utils';

const BAND_CLASS = {
  low: 'bg-score-low text-score-low-foreground',
  mid: 'bg-score-mid text-score-mid-foreground',
  high: 'bg-score-high text-score-high-foreground',
} as const;

/** Punteggio 0-100 su scala rosso → arancio → verde, sempre accompagnato dall'etichetta testuale. */
export function ScoreBadge({
  score,
  llmScore,
  className,
}: {
  score: number;
  llmScore?: number | null;
  className?: string;
}) {
  const { band, label } = scoreBand(score);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
        BAND_CLASS[band],
        className,
      )}
      title={`Punteggio a regole: ${score}/100 (${label.toLowerCase()})${llmScore !== null && llmScore !== undefined ? ` · LLM: ${llmScore}/100` : ''}`}
    >
      <span aria-hidden="true">{score}</span>
      <span className="sr-only">Punteggio {score} su 100:</span>
      <span className="font-medium">{label}</span>
      {llmScore !== null && llmScore !== undefined && (
        <span className="border-l border-current/40 pl-1.5 font-medium">LLM {llmScore}</span>
      )}
    </span>
  );
}
