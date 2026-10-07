import { settingsSchema, type ProfileResponse } from '@jobagg/shared';
import { Briefcase, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CountryCombobox } from '@/components/profile/CountryCombobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { errorMessage, useCountries, useSaveProfile } from '@/lib/queries';
import { listTimezones } from '@/lib/timezones';

/**
 * Primo avvio: paese, P.IVA e fuso orario. Il pulsante finale salva le impostazioni come un
 * normale salvataggio della sezione Profilo; da quel momento lo scheduler avvia le raccolte.
 */
export function OnboardingPage({ profile }: { profile: ProfileResponse }) {
  const countries = useCountries();
  const save = useSaveProfile();
  const [country, setCountry] = useState<string | undefined>(profile.settings.user.country);
  const [hasVat, setHasVat] = useState<boolean>(profile.settings.user.has_vat_number ?? false);
  const [timezone, setTimezone] = useState<string | undefined>(profile.settings.user.timezone);
  const [error, setError] = useState<string | null>(null);

  const selected = countries.data?.find((c) => c.code === country);
  const effectiveTimezone = timezone ?? selected?.timezone;
  const timezones = useMemo(() => listTimezones([effectiveTimezone]), [effectiveTimezone]);

  const submit = () => {
    if (!country) {
      setError('Seleziona il paese in cui risiedi');
      return;
    }
    const candidate = settingsSchema.safeParse({
      ...profile.settings,
      user: { country, has_vat_number: hasVat, timezone: effectiveTimezone },
    });
    if (!candidate.success) {
      setError(candidate.error.issues[0]?.message ?? 'Dati non validi');
      return;
    }
    setError(null);
    save.mutate(candidate.data, {
      onSuccess: () => toast.success('Profilo salvato: la prima raccolta di annunci è partita'),
      onError: (err) => setError(err instanceof ApiError && err.errors[0] ? err.errors[0].message : errorMessage(err)),
    });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="size-5" />
          </div>
          <CardTitle className="text-xl">Benvenuto in Iobdesk</CardTitle>
          <CardDescription>
            Tre informazioni per filtrare gli annunci in base a dove vivi e a come puoi lavorare. Restano sul tuo
            computer e si possono cambiare in qualsiasi momento dalla sezione Profilo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="onb-country">Paese di residenza</Label>
            {countries.isPending ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <CountryCombobox
                id="onb-country"
                countries={countries.data ?? []}
                value={country}
                invalid={!!error && !country}
                onChange={(code) => {
                  setCountry(code);
                  // il fuso viene precompilato dal paese, ma resta modificabile
                  setTimezone(undefined);
                  setError(null);
                }}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Determina le aree accettate (es. Europa, UE, EMEA), la valuta degli stipendi e gli annunci da scartare
              perché limitati ad altri paesi.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-1">
              <Label htmlFor="onb-vat">Ho una partita IVA / VAT number</Label>
              <p className="text-xs text-muted-foreground">
                Indica se puoi fatturare come libero professionista o azienda. Senza, i ruoli contract/B2B vengono
                penalizzati (tranne quelli tramite Employer of Record).
              </p>
            </div>
            <Switch id="onb-vat" checked={hasVat} onCheckedChange={setHasVat} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="onb-tz">Fuso orario</Label>
            <Select value={effectiveTimezone ?? ''} onValueChange={setTimezone} disabled={!country}>
              <SelectTrigger id="onb-tz">
                <SelectValue placeholder="Seleziona prima il paese" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Usato per verificare la compatibilità con gli orari richiesti dagli annunci.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">Finché non salvi, nessun annuncio viene raccolto.</p>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Salva e inizia
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
