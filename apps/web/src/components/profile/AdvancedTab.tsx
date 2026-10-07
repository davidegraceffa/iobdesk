import { EXTERNAL_LLM_PROVIDERS, LLM_PROVIDERS, type ProfileResponse } from '@jobagg/shared';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberField, SectionCard, SwitchField, TextField, type SettingsForm } from './fields';

const PROVIDER_LABEL: Record<string, string> = {
  ollama: 'Ollama (locale, nel container)',
  anthropic: 'Claude · Agent SDK (esterno)',
  openai: 'OpenAI (esterno)',
};
/** Modello proposto quando si cambia provider; resta modificabile a mano. */
const DEFAULT_MODEL: Record<string, string> = { ollama: 'llama3.1', anthropic: 'claude-opus-5-5', openai: '' };

function SecretStatus({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-muted-foreground" />}
      {label}: {ok ? 'configurato' : 'non configurato'}
    </span>
  );
}

export function AdvancedTab({ form, profile }: { form: SettingsForm; profile: ProfileResponse }) {
  const provider = useWatch({ control: form.control, name: 'scoring.llm.provider' });
  const enabled = useWatch({ control: form.control, name: 'scoring.llm.enabled' });
  const external = EXTERNAL_LLM_PROVIDERS.includes(provider);
  const keyMissing =
    (provider === 'anthropic' && !profile.secrets.anthropic) || (provider === 'openai' && !profile.secrets.openai);

  return (
    <div className="grid gap-4">
      <SectionCard
        title="LLM"
        description="Opzionale e disattivato di default. Serve per il punteggio LLM dei nuovi annunci e per generare i CV su misura."
      >
        <SwitchField
          form={form}
          name="scoring.llm.enabled"
          label="Usa un LLM"
          description="Con Ollama i dati restano su questo computer."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="scoring.llm.provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provider</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // cambiare provider propone il suo modello di default e richiede un nuovo consenso
                    form.setValue('scoring.llm.model', DEFAULT_MODEL[value] ?? '', {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    form.setValue('scoring.llm.external_consent', false, { shouldDirty: true });
                  }}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LLM_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profile.llm.forcedByEnv && (
                  <FormDescription>
                    Attualmente forzato da LLM_PROVIDER nel file .env: {profile.llm.provider}.
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <TextField
            form={form}
            name="scoring.llm.model"
            label="Modello"
            placeholder={provider === 'openai' ? 'Nome del modello OpenAI' : undefined}
            description={
              provider === 'ollama' ? (
                <>
                  Da scaricare una volta con <code>docker compose exec ollama ollama pull &lt;modello&gt;</code>
                </>
              ) : undefined
            }
          />
        </div>
        <TextField
          form={form}
          name="scoring.llm.fast_model"
          label="Modello rapido per la conversazione nei colloqui"
          placeholder={provider === 'anthropic' ? 'claude-sonnet-5-5 (automatico)' : 'Stesso modello (automatico)'}
          description="Usato solo per le repliche dell’intervistatore, che devono arrivare in un paio di secondi. Vuoto = scelta automatica. Domande e valutazioni usano sempre il modello principale."
        />

        {external && (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>Provider esterno</AlertTitle>
            <AlertDescription>
              <p>
                Con {PROVIDER_LABEL[provider]} le descrizioni degli annunci, il tuo profilo e — quando generi un CV — il
                testo del tuo CV (dati personali inclusi) vengono inviati a un servizio di terze parti.
              </p>
              <FormField
                control={form.control}
                name="scoring.llm.external_consent"
                render={({ field }) => (
                  <FormItem className="mt-1">
                    <label className="flex items-start gap-2 font-medium">
                      <FormControl>
                        <Checkbox
                          className="mt-0.5"
                          checked={field.value}
                          onCheckedChange={(c) => field.onChange(c === true)}
                        />
                      </FormControl>
                      Acconsento all’invio di questi dati al provider esterno
                    </label>
                    <FormDescription className="text-warning-foreground/80">
                      Senza consenso l’LLM non viene usato. Puoi revocarlo togliendo la spunta e salvando.
                    </FormDescription>
                  </FormItem>
                )}
              />
              {keyMissing && (
                <p className="font-medium">
                  Mancano le credenziali: imposta{' '}
                  {provider === 'anthropic' ? 'ANTHROPIC_API_KEY (o CLAUDE_CODE_OAUTH_TOKEN)' : 'OPENAI_API_KEY'} nel
                  file .env e riavvia con <code>docker compose up -d</code>.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
        {enabled && !profile.llm.ready && profile.llm.notReadyReason && (
          <p className="text-sm text-muted-foreground">
            Stato attuale (impostazioni salvate): {profile.llm.notReadyReason}.
          </p>
        )}
        <NumberField
          form={form}
          name="scoring.llm.min_score_to_notify"
          label="Punteggio LLM minimo per notificare"
          min={0}
          max={100}
          description="Se lo scoring LLM è attivo, un annuncio viene notificato solo se supera anche questa soglia."
        />
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <SecretStatus ok={profile.secrets.anthropic} label="Credenziali Claude" />
          <SecretStatus ok={profile.secrets.openai} label="OPENAI_API_KEY" />
        </div>
        <p className="text-xs text-muted-foreground">
          Le chiavi restano nel file .env: non vengono mai salvate nel database né mostrate qui.
        </p>
      </SectionCard>

      <SectionCard title="Notifiche Telegram" description="Un messaggio per ogni nuovo annuncio sopra soglia.">
        <SwitchField form={form} name="notifications.telegram.enabled" label="Invia notifiche Telegram" />
        <NumberField form={form} name="notifications.telegram.min_score" label="Punteggio minimo" min={0} max={100} />
        <SecretStatus ok={profile.secrets.telegram} label="TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID" />
      </SectionCard>

      <SectionCard title="Candidature e duplicati">
        <NumberField
          form={form}
          name="applications.followup_days"
          label="Giorni senza risposta prima di suggerire un follow-up"
          min={1}
          max={180}
          suffix="giorni"
        />
        <NumberField
          form={form}
          name="dedupe.similarity_threshold"
          label="Soglia di similarità per i duplicati"
          min={0.3}
          max={1}
          step={0.05}
          description="Due annunci con azienda e titolo simili oltre questa soglia sono considerati lo stesso annuncio. Vale per le prossime raccolte."
        />
        <SecretStatus ok={profile.secrets.imap} label="IMAP per gli alert via email" />
      </SectionCard>
    </div>
  );
}
