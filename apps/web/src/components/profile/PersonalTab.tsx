import { acceptedRegionsFor, getCountry, resolveTimezone, tzOffsetHours } from '@jobagg/shared';
import { useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCountries } from '@/lib/queries';
import { listTimezones } from '@/lib/timezones';
import { CountryCombobox } from './CountryCombobox';
import { SectionCard, SwitchField, TextField, type SettingsForm } from './fields';

const AUTO = '__auto__';

export function PersonalTab({ form }: { form: SettingsForm }) {
  const countries = useCountries();
  const country = useWatch({ control: form.control, name: 'user.country' });
  const timezone = useWatch({ control: form.control, name: 'user.timezone' });
  const extraRegions = useWatch({ control: form.control, name: 'location.extra_accepted_regions' });
  const meta = getCountry(country);
  const effectiveTz = resolveTimezone(country, timezone);
  const timezones = useMemo(() => listTimezones([timezone, meta?.timezone]), [timezone, meta?.timezone]);
  const regions = country
    ? [...new Set([...acceptedRegionsFor(country), ...(extraRegions ?? []).map((r) => r.toLowerCase())])]
    : [];
  const offset = tzOffsetHours(effectiveTz);

  return (
    <div className="grid gap-4">
      <SectionCard
        title="Dove vivi e come puoi lavorare"
        description="Questi dati determinano filtri e punteggi: cambiandoli, tutti gli annunci vengono ricalcolati."
      >
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="user.country"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Paese di residenza</FormLabel>
                {countries.isPending ? (
                  <Skeleton className="h-9" />
                ) : (
                  <FormControl>
                    <CountryCombobox
                      countries={countries.data ?? []}
                      value={field.value}
                      invalid={!!fieldState.error}
                      onChange={(code) => {
                        field.onChange(code);
                        // cambiando paese il fuso torna a quello di default del nuovo paese
                        form.setValue('user.timezone', undefined, { shouldDirty: true });
                      }}
                    />
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="user.timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fuso orario</FormLabel>
                <Select value={field.value ?? AUTO} onValueChange={(v) => field.onChange(v === AUTO ? undefined : v)}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={AUTO}>Dal paese{meta ? ` (${meta.timezone})` : ''}</SelectItem>
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Attuale: {effectiveTz} (UTC{offset >= 0 ? '+' : ''}
                  {offset})
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <SwitchField
          form={form}
          name="user.has_vat_number"
          label="Ho una partita IVA / VAT number"
          description="Indica se puoi fatturare come libero professionista o azienda (Partita IVA, VAT number o equivalente locale)."
        />
        {meta && (
          <dl className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt className="text-muted-foreground">Valuta degli stipendi</dt>
            <dd>{meta.currency}</dd>
            <dt className="text-muted-foreground">Unione Europea</dt>
            <dd>{meta.eu ? 'Sì' : 'No'}</dd>
            <dt className="text-muted-foreground">Aree accettate</dt>
            <dd className="flex flex-wrap gap-1">
              {regions.map((r) => (
                <Badge key={r} variant="secondary">
                  {r}
                </Badge>
              ))}
            </dd>
          </dl>
        )}
      </SectionCard>

      <SectionCard
        title="Profilo professionale"
        description="Usato nel prompt dello scoring LLM (se attivo). Non influisce sui filtri a regole."
      >
        <TextField form={form} name="profile.title" label="Titolo" placeholder="Es. Full-stack TypeScript Developer" />
        <FormField
          control={form.control}
          name="profile.summary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sommario</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </SectionCard>
    </div>
  );
}
