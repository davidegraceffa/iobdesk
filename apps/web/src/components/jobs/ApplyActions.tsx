import type { JobListItem } from '@jobagg/shared';
import { ExternalLink, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APPLY_METHOD_LABEL } from '@/lib/format';

interface Props {
  job: Pick<JobListItem, 'id' | 'applyUrl' | 'applyMethod' | 'sourceUrl' | 'sourceName'>;
  /** chiamato al click su "Candidati": al ritorno sulla scheda l'app chiede se la candidatura è stata inviata */
  onApplyClick: () => void;
  size?: 'sm' | 'default';
}

/**
 * Pulsante primario "Candidati" (apre il link diretto in una nuova scheda, o il client email
 * per i mailto:) con indicazione del metodo, e link secondario all'annuncio sulla fonte.
 */
export function ApplyActions({ job, onApplyClick, size = 'default' }: Props) {
  const href = job.applyUrl ?? job.sourceUrl;
  const isMail = href.startsWith('mailto:');
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button asChild size={size}>
        <a
          href={href}
          target={isMail ? undefined : '_blank'}
          rel="noopener noreferrer"
          onClick={(event) => {
            event.stopPropagation();
            onApplyClick();
          }}
        >
          {isMail ? <Mail /> : <Send />}
          Candidati
          <span className="font-normal opacity-80">· {APPLY_METHOD_LABEL[job.applyMethod]}</span>
        </a>
      </Button>
      <a
        href={job.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center gap-1 text-sm text-primary-text underline-offset-2 hover:underline"
      >
        Vedi annuncio sulla fonte <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
