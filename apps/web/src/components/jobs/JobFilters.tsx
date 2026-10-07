import { JOB_STATUSES, type JobsQuery, type SourceStatusDto } from '@jobagg/shared';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { CONTRACT_LABEL, JOB_STATUS_LABEL } from '@/lib/format';

const ALL = '__all__';

export const DEFAULT_QUERY: JobsQuery = { sort: 'score', page: 1 };

export function countActiveFilters(query: JobsQuery): number {
  return [
    query.q,
    // "Nuovo" è il filtro predefinito: conta solo uno stato diverso
    query.status !== 'new',
    query.source,
    query.minScore,
    query.contractType,
    query.vatCompatible,
    query.includeRejected,
  ].filter(Boolean).length;
}

interface Props {
  query: JobsQuery;
  sources: SourceStatusDto[];
  onChange: (patch: Partial<JobsQuery>) => void;
  onReset: () => void;
}

/** Filtri della lista: usati nella sidebar su desktop e nello Sheet laterale sugli schermi stretti. */
export function JobFilters({ query, sources, onChange, onReset }: Props) {
  // la ricerca testuale parte dopo una breve pausa nella digitazione
  const [search, setSearch] = useState(query.q ?? '');
  useEffect(() => setSearch(query.q ?? ''), [query.q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((query.q ?? '') !== search.trim()) onChange({ q: search.trim() || undefined });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const [score, setScore] = useState(query.minScore ?? 0);
  useEffect(() => setScore(query.minScore ?? 0), [query.minScore]);

  return (
    <form className="grid grid-cols-1 gap-5" onSubmit={(e) => e.preventDefault()} aria-label="Filtri annunci">
      <div className="grid gap-2">
        <Label htmlFor="f-q">Ricerca</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="f-q"
            type="search"
            className="pl-8"
            placeholder="Titolo, azienda, descrizione…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-status">Stato</Label>
        <Select
          value={query.status || ALL}
          onValueChange={(v) => onChange({ status: v === ALL ? undefined : (v as JobsQuery['status']) })}
        >
          <SelectTrigger id="f-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutti tranne gli scartati</SelectItem>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-source">Fonte</Label>
        <Select value={query.source || ALL} onValueChange={(v) => onChange({ source: v === ALL ? undefined : v })}>
          <SelectTrigger id="f-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutte le fonti</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label id="f-score-label">Punteggio minimo</Label>
          <output className="text-sm text-muted-foreground tabular-nums">{score}</output>
        </div>
        <Slider
          aria-label="Punteggio minimo"
          min={0}
          max={100}
          step={5}
          value={[score]}
          onValueChange={([v]) => setScore(v ?? 0)}
          onValueCommit={([v]) => onChange({ minScore: v || undefined })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-contract">Contratto</Label>
        <Select
          value={query.contractType || ALL}
          onValueChange={(v) => onChange({ contractType: v === ALL ? undefined : (v as JobsQuery['contractType']) })}
        >
          <SelectTrigger id="f-contract">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutti i contratti</SelectItem>
            {(['full-time', 'part-time', 'contract', 'freelance', 'unknown'] as const).map((c) => (
              <SelectItem key={c} value={c}>
                {CONTRACT_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={!!query.vatCompatible}
            onCheckedChange={(c) => onChange({ vatCompatible: c === true || undefined })}
          />
          <span>
            Solo compatibili col mio profilo
            <span className="block text-xs text-muted-foreground">
              Nasconde i ruoli che richiedono una P.IVA che non hai
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={!!query.includeRejected}
            onCheckedChange={(c) => onChange({ includeRejected: c === true || undefined })}
          />
          <span>
            Mostra scartati
            <span className="block text-xs text-muted-foreground">
              Include gli annunci esclusi dai filtri, con il motivo
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-sort">Ordina per</Label>
        <Select value={query.sort ?? 'score'} onValueChange={(v) => onChange({ sort: v as JobsQuery['sort'] })}>
          <SelectTrigger id="f-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Punteggio</SelectItem>
            <SelectItem value="date">Data di pubblicazione</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {countActiveFilters(query) > 0 && (
        <Button variant="outline" size="sm" onClick={onReset}>
          <X /> Azzera filtri
        </Button>
      )}
    </form>
  );
}
