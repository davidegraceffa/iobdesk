import type { InterviewBrief } from '@jobagg/shared';
import { ListChecks } from 'lucide-react';

/** Prima di iniziare: i temi principali del colloquio, ricavati dalla descrizione dell'annuncio. */
export function InterviewBriefCard({ brief }: { brief: InterviewBrief }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-muted/40 p-4 md:p-5" aria-label="Temi del colloquio">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="size-4" /> Di cosa si parlerà
      </h2>
      {brief.summary && <p className="text-sm text-muted-foreground">{brief.summary}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {brief.topics.map((topic) => (
          <li key={topic.title} className="rounded-lg border bg-card px-3 py-2 text-sm">
            <p className="font-medium">{topic.title}</p>
            <p className="text-muted-foreground">{topic.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
