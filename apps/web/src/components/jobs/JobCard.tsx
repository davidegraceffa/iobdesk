import type { JobListItem } from '@jobagg/shared';
import { Bookmark, BookmarkCheck, FileText, Trash2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate, languageLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApplyActions } from './ApplyActions';
import { CompanyAvatar, JobMetaBadges, SalaryInfo, SourceInfo } from './JobFacts';
import { ScoreBadge } from './ScoreBadge';
import { TechStackBadges } from './TechStackBadges';

export interface CvAvailability {
  available: boolean;
  /** spiegazione mostrata nel tooltip quando l'azione è disabilitata */
  reason: string | null;
}

interface Props {
  job: JobListItem;
  selected: boolean;
  boost: Set<string>;
  cv: CvAvailability;
  onSelect: () => void;
  onOpen: () => void;
  onApplyClick: () => void;
  onGenerateCv: () => void;
  onToggleSaved: () => void;
  onToggleDiscarded: () => void;
}

export function JobBadges({ job }: { job: JobListItem }) {
  return (
    <>
      {job.status === 'new' && !job.rejectedReason && <Badge>Nuovo</Badge>}
      {job.status === 'saved' && <Badge variant="secondary">Salvato</Badge>}
      {job.application && <Badge variant="success">Candidato il {formatDate(job.application.appliedAt)}</Badge>}
      {job.status === 'interview' && <Badge variant="success">Colloquio</Badge>}
      {job.status === 'discarded' && <Badge variant="muted">Scartato da te</Badge>}
      {job.vatBadge && <Badge variant="destructive">Richiede P.IVA/VAT</Badge>}
      {job.viaEor && <Badge variant="outline">Via EOR</Badge>}
      {job.generatedCvs.count > 0 && job.generatedCvs.latestId && (
        <Badge variant="outline">
          <Link
            to={`/cv/${job.generatedCvs.latestId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <FileText className="size-3" />
            CV generato · {job.generatedCvs.languages.map(languageLabel).join(', ')} · {job.generatedCvs.count}{' '}
            {job.generatedCvs.count === 1 ? 'versione' : 'versioni'}
          </Link>
        </Badge>
      )}
    </>
  );
}

/** Card compatta di un annuncio con tutte le informazioni obbligatorie sempre visibili. */
export function JobCard({
  job,
  selected,
  boost,
  cv,
  onSelect,
  onOpen,
  onApplyClick,
  onGenerateCv,
  onToggleSaved,
  onToggleDiscarded,
}: Props) {
  return (
    <article
      id={`job-${job.id}`}
      data-selected={selected}
      onClick={onSelect}
      className={cn(
        'grid gap-2.5 rounded-xl border bg-card p-4 shadow-xs transition-colors',
        selected && 'border-primary ring-2 ring-primary/50',
        job.rejectedReason && 'opacity-80',
      )}
    >
      <header className="flex items-start gap-3">
        <CompanyAvatar name={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-base leading-snug font-semibold">
              <button type="button" onClick={onOpen} className="rounded-sm text-left hover:underline">
                {job.title}
              </button>
            </h2>
            <JobBadges job={job} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm">
            <span className="font-semibold">{job.company}</span>
            <SourceInfo job={job} />
          </p>
        </div>
        <ScoreBadge score={job.ruleScore} llmScore={job.llmScore} />
      </header>

      <JobMetaBadges job={job} />

      {job.rejectedReason && (
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-sm">
          <span className="font-medium">Scartato dai filtri:</span> {job.rejectedReason}
        </p>
      )}

      <SalaryInfo job={job} />
      <TechStackBadges techStack={job.techStack} boost={boost} compact interactive />
      {job.descriptionPreview && <p className="line-clamp-3 text-sm text-muted-foreground">{job.descriptionPreview}</p>}

      <footer className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <ApplyActions job={job} onApplyClick={onApplyClick} size="sm" />
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled invece di disabled: il pulsante resta raggiungibile e il tooltip spiega come attivarlo */}
              <Button
                variant="secondary"
                size="sm"
                aria-disabled={!cv.available}
                onClick={(e) => {
                  e.stopPropagation();
                  if (cv.available) onGenerateCv();
                }}
              >
                <FileText />
                Genera CV
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {cv.available ? 'Genera un CV su misura per questo annuncio (c)' : cv.reason}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={job.status === 'saved' ? 'Rimuovi dai salvati' : 'Salva'}
                aria-pressed={job.status === 'saved'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSaved();
                }}
              >
                {job.status === 'saved' ? <BookmarkCheck /> : <Bookmark />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{job.status === 'saved' ? 'Rimuovi dai salvati (s)' : 'Salva (s)'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={job.status === 'discarded' ? 'Ripristina' : 'Scarta'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDiscarded();
                }}
              >
                {job.status === 'discarded' ? <Undo2 /> : <Trash2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{job.status === 'discarded' ? 'Ripristina (d)' : 'Scarta (d)'}</TooltipContent>
          </Tooltip>
        </div>
      </footer>
    </article>
  );
}
