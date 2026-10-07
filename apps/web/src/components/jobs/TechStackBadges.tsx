import { canonicalTech, TECH_CATEGORIES, type TechStack } from '@jobagg/shared';
import { Ban, Check, Search, Star } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TECH_CATEGORY_LABEL } from '@/lib/format';
import { keywordState, toggleKeyword, type KeywordList } from '@/lib/keywords';
import { errorMessage, useProfile, useSaveProfile } from '@/lib/queries';

/** Nomi canonici (minuscoli) delle tecnologie presenti nelle keyword "boost" dell'utente. */
export function useBoostSet(boost: string[] | undefined): Set<string> {
  return useMemo(() => {
    const set = new Set<string>();
    for (const keyword of boost ?? []) {
      set.add(keyword.toLowerCase());
      const tech = canonicalTech(keyword);
      if (tech) set.add(tech.name.toLowerCase());
    }
    return set;
  }, [boost]);
}

const LIST_LABEL: Record<KeywordList, string> = {
  boost: 'keyword preferite',
  required_any: 'keyword richieste',
  exclude: 'keyword escluse',
};

/** Aggiunge o toglie una tecnologia dalle keyword del Profilo, salvando subito le impostazioni. */
function useKeywordToggle() {
  const { data: profile } = useProfile();
  const save = useSaveProfile();
  const toggle = (tech: string, list: KeywordList) => {
    if (!profile) return;
    const wasThere = keywordState(profile.settings.keywords, tech)[list];
    save.mutate(
      { ...profile.settings, keywords: toggleKeyword(profile.settings.keywords, tech, list) },
      {
        onSuccess: () =>
          toast.success(`${tech} ${wasThere ? 'tolta dalle' : 'aggiunta alle'} ${LIST_LABEL[list]}`, {
            description: 'Filtri e punteggi degli annunci vengono ricalcolati in background.',
          }),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };
  return { keywords: profile?.settings.keywords, toggle, saving: save.isPending };
}

type KeywordActions = ReturnType<typeof useKeywordToggle>;

function TechBadge({ tech, boosted, actions }: { tech: string; boosted: boolean; actions: KeywordActions | null }) {
  const { keywords, toggle, saving } = actions ?? { keywords: undefined, toggle: () => undefined, saving: false };
  const badge = (
    <Badge variant={boosted ? 'default' : 'secondary'} title={boosted ? 'Tra le tue keyword preferite' : undefined}>
      {tech}
      {boosted && <span className="sr-only"> (preferita)</span>}
    </Badge>
  );
  if (!actions || !keywords) return badge;

  const state = keywordState(keywords, tech);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${tech}: aggiungi o togli dalle keyword di ricerca`}
          className="cursor-pointer rounded-md transition-opacity hover:opacity-80"
        >
          {badge}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>{tech} nelle preferenze di ricerca</DropdownMenuLabel>
        <DropdownMenuItem disabled={saving} onSelect={() => toggle(tech, 'boost')}>
          {state.boost ? <Check /> : <Star />}
          {state.boost ? 'Togli dalle preferite' : 'Aggiungi alle preferite (alza il punteggio)'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={saving} onSelect={() => toggle(tech, 'required_any')}>
          {state.required_any ? <Check /> : <Search />}
          {state.required_any ? 'Togli dalle richieste' : 'Aggiungi alle richieste (cerca annunci con questa)'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={saving} onSelect={() => toggle(tech, 'exclude')}>
          {state.exclude ? <Check /> : <Ban />}
          {state.exclude ? 'Non escludere più' : 'Escludi gli annunci che la citano'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Props {
  techStack: TechStack;
  boost: Set<string>;
  /** nella lista: una riga per categoria, compatta */
  compact?: boolean;
  /** cliccando una tecnologia la si può aggiungere alle keyword del Profilo */
  interactive?: boolean;
}

/** Stack tecnologico raggruppato per categoria; le categorie vuote sono nascoste. */
export function TechStackBadges({ techStack, boost, compact, interactive = false }: Props) {
  // un solo punto di salvataggio per card, condiviso da tutti i badge
  const toggleActions = useKeywordToggle();
  const actions = interactive ? toggleActions : null;
  const groups = TECH_CATEGORIES.map((category) => ({ category, items: techStack[category] ?? [] })).filter(
    (g) => g.items.length > 0,
  );
  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground">Stack non indicato nell’annuncio</p>;
  }
  if (compact) {
    // nella lista: categorie in linea, una dopo l'altra, per non allungare la card
    return (
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label="Stack tecnologico">
        {groups.map(({ category, items }) => (
          <div key={category} className="flex flex-wrap items-center gap-1">
            <dt className="mr-0.5 font-medium text-muted-foreground">{TECH_CATEGORY_LABEL[category]}</dt>
            {items.map((tech) => (
              <dd key={tech}>
                <TechBadge tech={tech} boosted={boost.has(tech.toLowerCase())} actions={actions} />
              </dd>
            ))}
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className="grid gap-x-3 gap-y-1.5 text-sm" aria-label="Stack tecnologico">
      {groups.map(({ category, items }) => (
        <div key={category} className="flex flex-wrap items-baseline gap-1.5">
          <dt className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{TECH_CATEGORY_LABEL[category]}</dt>
          <dd className="flex flex-1 flex-wrap gap-1">
            {items.map((tech) => (
              <TechBadge key={tech} tech={tech} boosted={boost.has(tech.toLowerCase())} actions={actions} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
