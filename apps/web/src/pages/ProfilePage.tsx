import { zodResolver } from '@hookform/resolvers/zod';
import { settingsSchema, type ProfilePreviewResult, type ProfileResponse, type Settings } from '@jobagg/shared';
import { Loader2, Save, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type FieldPath, type Resolver } from 'react-hook-form';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AdvancedTab } from '@/components/profile/AdvancedTab';
import { CriteriaTab } from '@/components/profile/CriteriaTab';
import { CvTab } from '@/components/profile/CvTab';
import { HistorySection } from '@/components/profile/HistorySection';
import { MailSyncSection } from '@/components/profile/MailSyncSection';
import { PersonalTab } from '@/components/profile/PersonalTab';
import { SourcesTab } from '@/components/profile/SourcesTab';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { errorMessage, useProfile, useSaveProfile } from '@/lib/queries';
import { PageSkeleton } from '../App';

const TABS = [
  { id: 'dati', label: 'Dati personali', prefixes: ['user', 'profile'] },
  {
    id: 'criteri',
    label: 'Criteri di ricerca',
    prefixes: ['keywords', 'seniority', 'contract', 'location', 'compensation', 'freshness'],
  },
  { id: 'fonti', label: 'Fonti', prefixes: ['sources', 'mail_sync'] },
  { id: 'cv', label: 'CV', prefixes: ['cv'] },
  { id: 'avanzate', label: 'Avanzate', prefixes: ['scoring', 'notifications', 'applications', 'dedupe'] },
] as const;

function ProfileForm({ profile }: { profile: ProfileResponse }) {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : 'dati';
  const save = useSaveProfile();
  const [confirm, setConfirm] = useState<{ settings: Settings; preview: ProfilePreviewResult | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const form = useForm<Settings>({
    // stesso schema Zod usato dall'API: gli errori compaiono sul campo interessato
    resolver: zodResolver(settingsSchema) as unknown as Resolver<Settings>,
    defaultValues: profile.settings,
    mode: 'onChange',
  });
  const { isDirty, errors } = form.formState;

  // ritorno dall'autorizzazione Google: esito in un parametro, tolto subito dall'indirizzo
  const gmail = params.get('gmail');
  useEffect(() => {
    if (!gmail) return;
    if (gmail === 'connected') toast.success('Gmail collegata: le candidature verranno aggiornate dalle email');
    else if (gmail === 'denied') toast.error('Autorizzazione negata: Gmail non è stata collegata');
    else toast.error('Collegamento a Gmail non riuscito: riprova');
    setParams({ tab: 'fonti' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail]);

  // dopo un salvataggio, un ripristino o un import il form riparte dalle impostazioni salvate
  // (dipende solo dalla versione: un semplice refetch non deve azzerare ciò che si sta scrivendo)
  useEffect(() => {
    form.reset(profile.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.version]);

  // avviso se si esce con modifiche non salvate (chiusura della scheda e navigazione interna)
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const tabsWithErrors = new Set(TABS.filter((t) => t.prefixes.some((p) => p in errors)).map((t) => t.id));

  // prima di salvare: anteprima di quanti annunci passerebbero i nuovi criteri
  const onSubmit = form.handleSubmit(
    async (values) => {
      setPreviewing(true);
      let preview: ProfilePreviewResult | null;
      try {
        preview = await api.profile.preview(values);
      } catch {
        preview = null;
      }
      setPreviewing(false);
      setConfirm({ settings: values, preview });
    },
    () => {
      const first = TABS.find((t) => t.prefixes.some((p) => p in form.formState.errors));
      if (first) setParams({ tab: first.id }, { replace: true });
      toast.error('Controlla i campi evidenziati: nulla è stato salvato');
    },
  );

  const doSave = () => {
    if (!confirm) return;
    save.mutate(confirm.settings, {
      onSuccess: () => {
        setConfirm(null);
        toast.success('Impostazioni salvate: filtri e punteggi vengono ricalcolati in background');
      },
      onError: (error) => {
        setConfirm(null);
        if (error instanceof ApiError && error.errors.length > 0) {
          // errori di validazione dell'API riportati sul campo interessato
          for (const e of error.errors)
            form.setError(e.path as FieldPath<Settings>, { type: 'server', message: e.message });
        }
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="pb-24">
        <div className="p-4 md:p-6">
          <header className="mb-4">
            <h1 className="text-xl font-semibold">Profilo</h1>
            <p className="text-sm text-muted-foreground">
              Tutte le impostazioni in un posto solo. Ultimo salvataggio: {formatDateTime(profile.updatedAt)} (versione{' '}
              {profile.version}).
            </p>
          </header>

          <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  {tabsWithErrors.has(t.id) && (
                    <span className="size-2 rounded-full bg-destructive">
                      <span className="sr-only"> (contiene errori)</span>
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="dati">
              <PersonalTab form={form} />
            </TabsContent>
            <TabsContent value="criteri">
              <CriteriaTab form={form} />
            </TabsContent>
            <TabsContent value="fonti">
              <div className="grid gap-4">
                <SourcesTab form={form} />
                <MailSyncSection form={form} />
              </div>
            </TabsContent>
            <TabsContent value="cv">
              <CvTab form={form} saved={profile.settings} />
            </TabsContent>
            <TabsContent value="avanzate">
              <AdvancedTab form={form} profile={profile} />
            </TabsContent>
          </Tabs>

          <div className="mt-6">
            <HistorySection dirty={isDirty} />
          </div>
        </div>

        {/* barra di salvataggio sempre visibile: il pulsante si attiva solo se ci sono modifiche */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur md:left-52">
          <div className="flex items-center gap-3 px-4 py-3 md:px-6">
            <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
              {isDirty ? 'Modifiche non salvate' : 'Nessuna modifica da salvare'}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || save.isPending}
              onClick={() => form.reset(profile.settings)}
            >
              <Undo2 /> Annulla modifiche
            </Button>
            <Button type="submit" disabled={!isDirty || save.isPending || previewing}>
              {save.isPending || previewing ? <Loader2 className="animate-spin" /> : <Save />}
              Salva
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salvare le impostazioni?</DialogTitle>
            <DialogDescription>Tutti gli annunci esistenti verranno ricalcolati con i nuovi criteri.</DialogDescription>
          </DialogHeader>
          {confirm?.preview ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm">
              <dt>Annunci che passano i filtri ora</dt>
              <dd className="text-right font-medium tabular-nums">{confirm.preview.acceptedNow}</dd>
              <dt>Con le nuove impostazioni</dt>
              <dd className="text-right font-semibold tabular-nums">{confirm.preview.acceptedAfter}</dd>
              <dt className="text-muted-foreground">Annunci totali (senza duplicati)</dt>
              <dd className="text-right text-muted-foreground tabular-nums">{confirm.preview.total}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Anteprima non disponibile.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Torna alle modifiche
            </Button>
            <Button onClick={doSave} disabled={save.isPending} autoFocus>
              {save.isPending && <Loader2 className="animate-spin" />}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hai modifiche non salvate</DialogTitle>
            <DialogDescription>Se esci dal Profilo adesso, le modifiche andranno perse.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Resta qui
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              Esci senza salvare
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}

/** Sezione Profilo: unica pagina per profilo utente, criteri, fonti, CV e impostazioni avanzate. */
export function ProfilePage() {
  const { data: profile } = useProfile();
  if (!profile) return <PageSkeleton />;
  return <ProfileForm profile={profile} />;
}
