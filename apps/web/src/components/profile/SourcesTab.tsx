import { SOURCE_IDS } from '@jobagg/shared';
import { Badge } from '@/components/ui/badge';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSources } from '@/lib/queries';
import { SectionCard, type SettingsForm } from './fields';

/** Abilitazione e intervalli delle fonti, con suggerimenti in base al paese dell'utente. */
export function SourcesTab({ form }: { form: SettingsForm }) {
  const sources = useSources();
  const info = new Map((sources.data ?? []).map((s) => [s.id, s]));

  return (
    <SectionCard
      title="Fonti degli annunci"
      description="Solo API pubbliche, endpoint JSON e feed RSS. Nessuno scraping: per LinkedIn, Indeed e Glassdoor è previsto solo l’import delle email di alert."
    >
      {sources.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="grid gap-3">
          {SOURCE_IDS.map((id) => {
            const source = info.get(id);
            return (
              <li key={id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <FormField
                  control={form.control}
                  name={`sources.${id}.enabled`}
                  render={({ field }) => (
                    <FormItem className="flex items-start gap-3">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                      </FormControl>
                      <div className="grid gap-1">
                        <FormLabel className="flex flex-wrap items-center gap-2">
                          {source?.displayName ?? id}
                          {source?.relevant && <Badge variant="success">Consigliata per il tuo paese</Badge>}
                          {source && !source.relevant && <Badge variant="muted">Poco rilevante per il tuo paese</Badge>}
                          {source && !source.configured && (
                            <Badge variant="destructive">Credenziali mancanti in .env</Badge>
                          )}
                        </FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Copertura: {source?.relevantRegions.join(', ') ?? '—'}
                          {source?.attribution ? ` · ${source.attribution}` : ''}
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`sources.${id}.interval_minutes`}
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel className="text-xs font-normal text-muted-foreground">ogni</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={15}
                            step={15}
                            className="w-24"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={Number.isFinite(field.value) ? field.value : ''}
                            onChange={(e) =>
                              field.onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <span className="text-xs text-muted-foreground">minuti</span>
                      </div>
                      {source && Number.isFinite(field.value) && field.value < source.minIntervalMinutes && (
                        <p className="text-xs text-muted-foreground">
                          Per rispettare la fonte l’intervallo effettivo sarà {source.minIntervalMinutes} minuti.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
