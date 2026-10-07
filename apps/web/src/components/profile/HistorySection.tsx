import type { ProfileImportPreview, SettingsDiffEntry } from '@jobagg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, Loader2, RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { errorMessage, keys } from '@/lib/queries';
import { SectionCard } from './fields';

const REASON_LABEL: Record<string, string> = {
  seed: 'Seed iniziale',
  save: 'Salvataggio',
  import: 'Import da file',
  consent: 'Consenso LLM',
};

function show(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value || '""';
  return JSON.stringify(value);
}

export function DiffList({ changes }: { changes: SettingsDiffEntry[] }) {
  if (changes.length === 0) return <p className="text-sm text-muted-foreground">Nessuna differenza.</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {changes.map((c) => (
        <li key={c.path} className="rounded-md border p-2">
          <code className="text-xs font-medium">{c.path}</code>
          <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
            <span className="rounded bg-diff-removed px-1.5 py-0.5 break-words">
              <span className="sr-only">Prima: </span>
              {show(c.before)}
            </span>
            <span className="rounded bg-diff-added px-1.5 py-0.5 break-words">
              <span className="sr-only">Dopo: </span>
              {show(c.after)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Storico dei salvataggi con ripristino, export e import (con anteprima delle differenze). */
export function HistorySection({ dirty }: { dirty: boolean }) {
  const client = useQueryClient();
  const history = useQuery({ queryKey: keys.history, queryFn: api.profile.history });
  const fileInput = useRef<HTMLInputElement>(null);
  const [importContent, setImportContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProfileImportPreview | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.profile });
    void client.invalidateQueries({ queryKey: keys.history });
    void client.invalidateQueries({ queryKey: ['jobs'] });
  };

  const restore = useMutation({
    mutationFn: (id: string) => api.profile.restore(id),
    onSuccess: () => {
      toast.success('Versione ripristinata: annunci in ricalcolo');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const dryRun = useMutation({
    mutationFn: (content: string) => api.profile.import(content, true),
    onSuccess: (result) => setPreview(result),
    onError: (error) => {
      toast.error(errorMessage(error));
      setImportContent(null);
    },
  });

  const apply = useMutation({
    mutationFn: (content: string) => api.profile.import(content, false),
    onSuccess: () => {
      toast.success('Impostazioni importate');
      setPreview(null);
      setImportContent(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error('File troppo grande per essere un file di impostazioni');
      return;
    }
    const content = await file.text();
    setImportContent(content);
    dryRun.mutate(content);
  };

  return (
    <SectionCard
      title="Storico, export e import"
      description="Ogni salvataggio crea una versione ripristinabile. I segreti (.env) non fanno parte delle impostazioni e non vengono mai esportati."
    >
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={api.profile.exportUrl('yaml')} download>
            <Download /> Esporta YAML
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={api.profile.exportUrl('json')} download>
            <Download /> Esporta JSON
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={dryRun.isPending}>
          {dryRun.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Importa da file…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,.json,application/json,text/yaml"
          className="sr-only"
          tabIndex={-1}
          aria-label="File di impostazioni da importare"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {dirty && (
        <p className="text-xs text-muted-foreground">
          Hai modifiche non salvate: un ripristino o un import le sostituisce.
        </p>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <History className="size-4" /> Salvataggi
        </h3>
        {history.isPending ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <ol className="grid gap-1.5">
            {(history.data ?? []).map((entry, index) => (
              <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Versione {entry.version}</span>
                  <span className="text-muted-foreground">
                    {formatDateTime(entry.savedAt)} ·{' '}
                    {REASON_LABEL[entry.reason] ??
                      (entry.reason.startsWith('restore')
                        ? `Ripristino (${entry.reason.split(':')[1] ?? ''})`
                        : entry.reason)}
                  </span>
                  {index === 0 && <span className="text-xs text-muted-foreground">(attuale)</span>}
                  <span className="ml-auto flex gap-1">
                    {entry.changes.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                        aria-expanded={expanded === entry.id}
                      >
                        {entry.changes.length} {entry.changes.length === 1 ? 'modifica' : 'modifiche'}
                      </Button>
                    )}
                    {index > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(entry.id)}
                      >
                        <RotateCcw /> Ripristina
                      </Button>
                    )}
                  </span>
                </div>
                {expanded === entry.id && (
                  <div className="mt-2">
                    <DiffList changes={entry.changes} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setImportContent(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.valid ? 'Anteprima dell’import' : 'File non valido'}</DialogTitle>
            <DialogDescription>
              {preview?.valid
                ? 'Queste impostazioni cambieranno rispetto a quelle salvate. Nulla viene applicato finché non confermi.'
                : 'Il file contiene errori: nulla è stato modificato.'}
            </DialogDescription>
          </DialogHeader>
          {preview?.valid ? (
            <DiffList changes={preview.changes} />
          ) : (
            <ul className="grid gap-1 text-sm text-destructive">
              {preview?.errors.map((e) => (
                <li key={`${e.path}-${e.message}`}>
                  <code>{e.path || '(file)'}</code>: {e.message}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setImportContent(null);
              }}
            >
              {preview?.valid ? 'Annulla' : 'Chiudi'}
            </Button>
            {preview?.valid && (
              <Button
                disabled={apply.isPending || preview.changes.length === 0 || !importContent}
                onClick={() => importContent && apply.mutate(importContent)}
              >
                {apply.isPending && <Loader2 className="animate-spin" />}
                Applica
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
