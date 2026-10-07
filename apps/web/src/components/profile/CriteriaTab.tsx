import { CONTRACT_TYPES, getCountry, SENIORITY_LEVELS, VAT_POLICIES } from '@jobagg/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONTRACT_LABEL, SENIORITY_LABEL } from '@/lib/format';
import { CheckboxGroupField, NumberField, SectionCard, SwitchField, TagsField, type SettingsForm } from './fields';

const POLICY_LABEL: Record<(typeof VAT_POLICIES)[number], string> = {
  penalize: 'Penalizza: restano visibili con punteggio ridotto e badge',
  exclude: 'Escludi: vengono scartati',
  keep: 'Nessun effetto',
};

/** Tassi di cambio statici verso la valuta dell'utente (nessuna chiamata esterna). */
function FxRates({ form, currency }: { form: SettingsForm; currency: string }) {
  const rates = useWatch({ control: form.control, name: 'compensation.fx_rates_to_local' }) ?? {};
  const [code, setCode] = useState('');
  const set = (next: Record<string, number>) =>
    form.setValue('compensation.fx_rates_to_local', next, { shouldDirty: true, shouldValidate: true });
  return (
    <FormField
      control={form.control}
      name="compensation.fx_rates_to_local"
      render={() => (
        <FormItem>
          <FormLabel>Tassi di cambio verso {currency}</FormLabel>
          <div className="grid gap-2">
            {Object.entries(rates).map(([cur, rate]) => (
              <div key={cur} className="flex items-center gap-2 text-sm">
                <span className="w-24 tabular-nums">1 {cur} =</span>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  className="max-w-32"
                  aria-label={`Tasso ${cur} verso ${currency}`}
                  value={Number.isFinite(rate) ? rate : ''}
                  onChange={(e) =>
                    set({ ...rates, [cur]: e.target.value === '' ? Number.NaN : Number(e.target.value) })
                  }
                />
                <span>{currency}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rimuovi il tasso ${cur}`}
                  onClick={() => {
                    const next = { ...rates };
                    delete next[cur];
                    set(next);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                className="max-w-24 uppercase"
                maxLength={3}
                placeholder="USD"
                aria-label="Codice della valuta da aggiungere"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={code.length !== 3 || code in rates || code === currency}
                onClick={() => {
                  set({ ...rates, [code]: 1 });
                  setCode('');
                }}
              >
                <Plus /> Aggiungi valuta
              </Button>
            </div>
          </div>
          <FormDescription>
            Tassi statici, da aggiornare a mano. Gli stipendi in valute senza tasso vengono mostrati solo nella valuta
            originale e non vengono confrontati con le soglie.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CriteriaTab({ form }: { form: SettingsForm }) {
  const country = useWatch({ control: form.control, name: 'user.country' });
  const hasVat = useWatch({ control: form.control, name: 'user.has_vat_number' });
  const currency = getCountry(country)?.currency ?? 'valuta locale';

  return (
    <div className="grid gap-4">
      <SectionCard
        title="Keyword"
        description="Cercate in titolo, tag, descrizione e stack tecnologico. Le tecnologie riconoscono anche gli alias (es. “postgres” trova PostgreSQL)."
      >
        <TagsField
          form={form}
          name="keywords.required_any"
          label="Richieste (almeno una)"
          description="Un annuncio senza nessuna di queste viene scartato. Vuoto = nessun vincolo."
        />
        <TagsField
          form={form}
          name="keywords.boost"
          label="Preferite"
          description="Alzano il punteggio e vengono evidenziate col colore primario nello stack."
        />
        <TagsField
          form={form}
          name="keywords.exclude"
          label="Escluse"
          description="Un annuncio che ne contiene una viene scartato."
        />
      </SectionCard>

      <SectionCard
        title="Aziende bloccate"
        description="Le offerte di queste aziende vengono scartate. Puoi bloccarne una anche dal dettaglio di un annuncio."
      >
        <TagsField
          form={form}
          name="companies.blocked"
          label="Aziende"
          description="Conta il nome intero, senza maiuscole né forma societaria: “Acme” blocca anche “ACME Inc.”, ma non “Acme Robotics”."
          placeholder="Nome dell’azienda"
        />
      </SectionCard>

      <SectionCard title="Seniority e contratto">
        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxGroupField
            form={form}
            name="seniority.include"
            label="Seniority cercate"
            options={SENIORITY_LEVELS.map((s) => ({ value: s, label: SENIORITY_LABEL[s] }))}
          />
          <CheckboxGroupField
            form={form}
            name="seniority.exclude"
            label="Seniority da scartare"
            options={SENIORITY_LEVELS.map((s) => ({ value: s, label: SENIORITY_LABEL[s] }))}
          />
        </div>
        <CheckboxGroupField
          form={form}
          name="contract.types"
          label="Tipi di contratto accettati"
          options={CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_LABEL[c] }))}
          description="Gli annunci che non indicano il contratto restano visibili."
        />
        <FormField
          control={form.control}
          name="contract.without_vat_policy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ruoli contract/B2B senza P.IVA</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="max-w-xl">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {VAT_POLICIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {POLICY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                {hasVat
                  ? 'Hai indicato di avere la P.IVA: questa regola non viene applicata.'
                  : 'I contratti tramite Employer of Record (Deel, Remote.com, Oyster…) non vengono mai penalizzati: non richiedono P.IVA.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </SectionCard>

      <SectionCard title="Località e orari">
        <SwitchField
          form={form}
          name="location.remote_only"
          label="Solo full remote"
          description="Scarta gli annunci ibridi o in sede. Quelli che non lo indicano restano visibili."
        />
        <TagsField
          form={form}
          name="location.extra_accepted_regions"
          label="Aree o paesi accettati in più"
          placeholder="Es. north america, switzerland"
          description="Oltre a quelli derivati dal tuo paese (vedi Dati personali)."
        />
        <TagsField
          form={form}
          name="location.extra_rejected_patterns"
          label="Testi che fanno scartare un annuncio"
          placeholder="Es. security clearance"
          description="Cercati in titolo, località e descrizione, oltre alle restrizioni geografiche rilevate in automatico."
        />
        <NumberField
          form={form}
          name="location.max_timezone_offset_hours"
          label="Scarto massimo di fuso orario"
          min={0}
          max={24}
          step={0.5}
          suffix="ore"
          description="Se l’annuncio chiede di lavorare in un fuso più lontano di così dal tuo, viene scartato."
        />
      </SectionCard>

      <SectionCard
        title="Retribuzione e freschezza"
        description={`Soglie espresse in ${currency}. Si applicano solo quando la retribuzione è scritta nell’annuncio: non viene mai stimata.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            form={form}
            name="compensation.min_yearly"
            label="Minimo annuo"
            min={0}
            step={1000}
            suffix={`${currency} / anno`}
          />
          <NumberField
            form={form}
            name="compensation.min_daily_rate"
            label="Tariffa giornaliera minima"
            min={0}
            step={10}
            suffix={`${currency} / giorno`}
          />
        </div>
        <SwitchField
          form={form}
          name="compensation.allow_missing"
          label="Accetta annunci senza retribuzione indicata"
        />
        <FxRates form={form} currency={currency} />
        <NumberField
          form={form}
          name="freshness.max_age_days"
          label="Età massima degli annunci"
          min={1}
          max={365}
          suffix="giorni"
        />
      </SectionCard>
    </div>
  );
}
