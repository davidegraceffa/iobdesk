import type { JobListItem, RemoteType } from '@jobagg/shared';
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarDays,
  Copy,
  ExternalLink,
  Globe,
  Laptop,
  MapPin,
  Rss,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CONTRACT_LABEL,
  formatDate,
  formatLocalSalary,
  formatMoneyRange,
  formatRelative,
  REMOTE_LABEL,
  SENIORITY_LABEL,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const PILL =
  'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0';

function hueOf(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  return hash;
}

/** Avatar con le iniziali dell'azienda: la tinta dipende dal nome, così la stessa azienda si riconosce a colpo d'occhio. */
export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  const words = name.replace(/\([^)]*\)/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        'company-avatar flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
        className,
      )}
      style={{ '--avatar-hue': hueOf(name.toLowerCase()) } as CSSProperties}
    >
      {initials}
    </span>
  );
}

/** Bandiera emoji da un codice ISO 3166-1 alpha-2. */
function flag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
}

/** Modalità di lavoro: il full remote è in evidenza, ibrido e in sede restano neutri. */
export function RemoteBadge({ remote }: { remote: RemoteType }) {
  if (remote === 'full') {
    return (
      <span className={cn(PILL, 'bg-tint-geo text-tint-geo-foreground')}>
        <Laptop aria-hidden="true" /> {REMOTE_LABEL.full}
      </span>
    );
  }
  if (remote === 'unknown') {
    return (
      <span className={cn(PILL, 'border border-dashed text-muted-foreground')}>
        <Laptop aria-hidden="true" /> {REMOTE_LABEL.unknown}
      </span>
    );
  }
  return (
    <span className={cn(PILL, 'border text-foreground')}>
      <Building2 aria-hidden="true" /> {REMOTE_LABEL[remote]}
    </span>
  );
}

/** Area geografica: testo della fonte, con le bandiere quando l'annuncio è limitato a pochi paesi. */
export function LocationBadge({ job }: { job: Pick<JobListItem, 'location' | 'regions' | 'restrictedCountries'> }) {
  const worldwide = job.regions.includes('worldwide') && job.restrictedCountries.length === 0;
  const flags = job.restrictedCountries.length <= 4 ? job.restrictedCountries.map(flag).filter(Boolean).join(' ') : '';
  const text = job.location || (worldwide ? 'Worldwide' : job.regions.join(', '));
  if (!text && !flags) return null;
  return (
    <span className={cn(PILL, 'bg-tint-geo text-tint-geo-foreground')} title={text}>
      {worldwide ? <Globe aria-hidden="true" /> : <MapPin aria-hidden="true" />}
      {flags && <span aria-hidden="true">{flags}</span>}
      <span className="max-w-56 truncate">{text}</span>
    </span>
  );
}

/** Data di pubblicazione: gli annunci degli ultimi 3 giorni risaltano, quelli vecchi sfumano. */
export function DateBadge({ date, now = new Date() }: { date: string; now?: Date }) {
  const days = (now.getTime() - new Date(date).getTime()) / 86_400_000;
  const fresh = days <= 3;
  return (
    <time
      dateTime={date}
      title={`Pubblicato il ${formatDate(date)}`}
      className={cn(
        PILL,
        fresh ? 'bg-tint-date text-tint-date-foreground' : 'border text-muted-foreground',
        days > 14 && 'border-dashed',
      )}
    >
      <CalendarDays aria-hidden="true" />
      {formatRelative(date, now)}
      {fresh && <span className="sr-only"> (recente)</span>}
    </time>
  );
}

/** Dati neutri (contratto, seniority): contorno senza tinta. */
export function MetaBadge({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className={cn(PILL, 'border text-foreground')}>
      {icon}
      {children}
    </span>
  );
}

/**
 * Riga dei dati dell'annuncio, uguale nella lista e nel dettaglio. Ogni tipo di dato ha la sua forma:
 * area geografica in verde acqua, data in viola se recente, contratto e seniority neutri.
 */
export function JobMetaBadges({
  job,
}: {
  job: Pick<
    JobListItem,
    | 'remote'
    | 'location'
    | 'regions'
    | 'restrictedCountries'
    | 'contractType'
    | 'seniority'
    | 'publishedAt'
    | 'firstSeenAt'
  >;
}) {
  const hasLocation = !!job.location || job.regions.length > 0 || job.restrictedCountries.length > 0;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Dati dell’annuncio">
      <li>
        <RemoteBadge remote={job.remote} />
      </li>
      {hasLocation && (
        <li className="min-w-0">
          <LocationBadge job={job} />
        </li>
      )}
      <li>
        <MetaBadge icon={<Briefcase aria-hidden="true" />}>{CONTRACT_LABEL[job.contractType]}</MetaBadge>
      </li>
      {job.seniority !== 'unknown' && (
        <li>
          <MetaBadge icon={<TrendingUp aria-hidden="true" />}>{SENIORITY_LABEL[job.seniority]}</MetaBadge>
        </li>
      )}
      <li>
        <DateBadge date={job.publishedAt ?? job.firstSeenAt} />
      </li>
    </ul>
  );
}

/**
 * RAL / retribuzione: il valore come scritto nell'annuncio, più la conversione nella valuta
 * dell'utente. Se l'annuncio non la indica lo si dice esplicitamente; una stima compare solo se
 * l'utente l'ha chiesta ("Genera RAL") ed è sempre presentata come tale.
 */
export function SalaryInfo({
  job,
}: {
  job: Pick<
    JobListItem,
    | 'salaryFound'
    | 'salaryRawText'
    | 'salaryLocalMin'
    | 'salaryLocalMax'
    | 'localCurrency'
    | 'salaryPeriod'
    | 'salaryCurrency'
  > &
    Partial<Pick<JobListItem, 'salaryEstimate'>>;
}) {
  if (!job.salaryFound && job.salaryEstimate) {
    const estimate = job.salaryEstimate;
    const showLocal =
      estimate.localMin !== null &&
      estimate.localMax !== null &&
      !!job.localCurrency &&
      job.localCurrency !== estimate.currency;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span
          className={cn(PILL, 'border border-dashed py-1 text-sm font-semibold text-foreground')}
          title="Stima generata dall’LLM: l’annuncio non indica la retribuzione"
        >
          <Sparkles aria-hidden="true" />
          RAL stimata: {formatMoneyRange(estimate.min, estimate.max, estimate.currency)} / anno
        </span>
        {showLocal && (
          <span className="text-muted-foreground">
            ≈ {formatMoneyRange(estimate.localMin!, estimate.localMax!, job.localCurrency!)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">non indicata nell’annuncio</span>
      </p>
    );
  }
  if (!job.salaryFound) {
    return (
      <p>
        <span className={cn(PILL, 'border border-dashed text-muted-foreground')}>
          <Banknote aria-hidden="true" />
          RAL non indicata
        </span>
      </p>
    );
  }
  const local = formatLocalSalary(job.salaryLocalMin, job.salaryLocalMax, job.localCurrency, job.salaryPeriod);
  const sameCurrency = job.salaryCurrency === job.localCurrency;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span
        className={cn(PILL, 'bg-tint-salary py-1 text-sm font-semibold text-tint-salary-foreground')}
        title="Come scritto nell’annuncio"
      >
        <Banknote aria-hidden="true" />
        {job.salaryRawText}
      </span>
      {local && <span className="text-muted-foreground">{sameCurrency ? local.replace('≈ ', '') : local}</span>}
      {!local && job.salaryCurrency && job.localCurrency && (
        <span className="text-xs text-muted-foreground">
          (tasso {job.salaryCurrency} → {job.localCurrency} non configurato)
        </span>
      )}
    </p>
  );
}

/** Fonte dell'annuncio, con l'elenco delle altre fonti su cui è stato trovato. */
export function SourceInfo({
  job,
  detailed,
}: {
  job: Pick<JobListItem, 'sourceName' | 'sourceUrl' | 'duplicates' | 'attribution'>;
  detailed?: boolean;
}) {
  const others = job.duplicates;
  if (detailed) {
    return (
      <div className="grid gap-1 text-sm">
        <p className="flex items-center gap-1.5">
          <Rss className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Fonte:</span>
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 hover:underline"
          >
            {job.sourceName}
          </a>
        </p>
        {others.length > 0 && (
          <div className="pl-5.5 text-muted-foreground">
            Trovato anche su:
            <ul className="mt-0.5 grid gap-0.5">
              {others.map((d) => (
                <li key={d.id}>
                  <a
                    href={d.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-text underline-offset-2 hover:underline"
                  >
                    {d.sourceName} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {job.attribution && <p className="pl-5.5 text-xs text-muted-foreground">{job.attribution}</p>}
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Rss className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Fonte: </span>
      {job.sourceName}
      {others.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex cursor-default items-center gap-0.5 rounded bg-muted px-1 text-xs"
              tabIndex={0}
            >
              <Copy className="size-3" aria-hidden="true" />+{others.length}
              <span className="sr-only"> altre fonti</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Trovato anche su: {[...new Set(others.map((d) => d.sourceName))].join(', ')}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
