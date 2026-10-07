import type { GeneratedCvDetail } from '@jobagg/shared';
import { CircleCheck, CircleDashed, CircleX, Lightbulb } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

function List({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title} <span className="font-normal text-muted-foreground">({items.length})</span>
      </h3>
      {items.length > 0 ? (
        <ul className="list-disc pl-8 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="pl-6 text-sm text-muted-foreground">Nessuno</p>
      )}
    </section>
  );
}

/** Pannello "Copertura requisiti": coperti, parziali, mancanti; i gap sono solo suggerimenti per l'utente. */
export function CoveragePanel({ cv }: { cv: GeneratedCvDetail }) {
  const { covered, partiallyCovered, missing } = cv.matchSummary;
  return (
    <div className="grid gap-5">
      <List title="Requisiti coperti" items={covered} icon={<CircleCheck className="size-4 text-success" />} />
      <List
        title="Parzialmente coperti"
        items={partiallyCovered}
        icon={<CircleDashed className="size-4 text-muted-foreground" />}
      />
      <List title="Mancanti" items={missing} icon={<CircleX className="size-4 text-destructive" />} />

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4" /> Suggerimenti
        </h3>
        <p className="text-xs text-muted-foreground">
          I requisiti scoperti non vengono mai inseriti nel CV in automatico. Se li possiedi davvero, aggiungili alle{' '}
          <Link to="/profile?tab=cv" className="text-primary-text underline underline-offset-2">
            competenze aggiuntive nel Profilo
          </Link>{' '}
          e rigenera.
        </p>
        {cv.gaps.length > 0 ? (
          <ul className="grid gap-2">
            {cv.gaps.map((gap) => (
              <li key={`${gap.requirement}-${gap.suggestion}`} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {gap.requirement}
                  <Badge variant={gap.importance === 'required' ? 'destructive' : 'muted'}>
                    {gap.importance === 'required' ? 'Obbligatorio' : 'Preferenziale'}
                  </Badge>
                </div>
                {gap.suggestion && <p className="mt-1 text-muted-foreground">{gap.suggestion}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nessun suggerimento.</p>
        )}
      </section>
    </div>
  );
}
