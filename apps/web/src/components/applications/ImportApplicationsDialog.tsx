import type { ApplicationImportResult } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { APPLICATION_STATUS_LABEL, formatDate } from '@/lib/format';
import { errorMessage } from '@/lib/queries';

const ACTION_LABEL = { create: 'Nuova', update: 'Da aggiornare', unchanged: 'Già presente' } as const;

/**
 * Import delle candidature da un file CSV (es. il foglio di tracciamento scaricato da Google Sheets):
 * prima l'anteprima di cosa verrà creato o aggiornato, poi la conferma.
 */
export function ImportApplicationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ApplicationImportResult | null>(null);

  useEffect(() => {
    if (open) {
      setContent(null);
      setFileName('');
      setPreview(null);
    }
  }, [open]);

  const dryRun = useMutation({
    mutationFn: (text: string) => api.applications.import(text, true),
    onSuccess: setPreview,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const apply = useMutation({
    mutationFn: (text: string) => api.applications.import(text, false),
    onSuccess: (result) => {
      toast.success(
        `Import completato: ${result.created} nuove, ${result.updated} aggiornate, ${result.unchanged} già presenti`,
      );
      void client.invalidateQueries({ queryKey: ['applications'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_400_000) {
      toast.error('File troppo grande: servono al massimo circa 1,4 MB di CSV');
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    setPreview(null);
    dryRun.mutate(text);
  };

  const nothingToDo = !!preview && preview.created === 0 && preview.updated === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importa candidature da CSV</DialogTitle>
          <DialogDescription>
            Da Google Sheets: File → Scarica → Valori separati da virgola (.csv). Colonne riconosciute: ID offerta, Data
            candidatura, Azienda, Posizione, Località, Portale, Link offerta, CV inviato, Lingua, Modalità, Stato, Note,
            Nazione. Reimportare lo stesso file non crea doppioni: aggiorna lo stato e riempie solo i campi ancora
            vuoti.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => input.current?.click()}
            disabled={dryRun.isPending || apply.isPending}
          >
            {dryRun.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
            {content ? 'Scegli un altro file' : 'Scegli il file CSV'}
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          <input
            ref={input}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-label="File CSV delle candidature"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {preview && (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['Righe valide', preview.total],
                  ['Nuove', preview.created],
                  ['Da aggiornare', preview.updated],
                  ['Già presenti', preview.unchanged],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            {preview.ignoredColumns.length > 0 && (
              <p className="text-sm text-muted-foreground">Colonne ignorate: {preview.ignoredColumns.join(', ')}.</p>
            )}
            {(preview.errors.length > 0 || preview.warnings.length > 0) && (
              <div
                role="alert"
                className="rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
              >
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4" />
                  {preview.errors.length > 0
                    ? `${preview.errors.length} ${preview.errors.length === 1 ? 'riga non verrà importata' : 'righe non verranno importate'}`
                    : 'Avvisi'}
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {[...preview.errors, ...preview.warnings].slice(0, 12).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Riga {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.preview.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      {['', 'Data', 'Azienda', 'Posizione', 'Portale', 'Nazione', 'Stato'].map((h) => (
                        <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                          {h || 'Azione'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row) => (
                      <tr key={row.row} className="border-b last:border-0">
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={
                              row.action === 'create' ? 'default' : row.action === 'update' ? 'warning' : 'muted'
                            }
                          >
                            {ACTION_LABEL[row.action]}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{formatDate(row.appliedAt)}</td>
                        <td className="px-2 py-1.5">{row.company}</td>
                        <td className="px-2 py-1.5">{row.title}</td>
                        <td className="px-2 py-1.5">{row.portal}</td>
                        <td className="px-2 py-1.5">{row.country}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{APPLICATION_STATUS_LABEL[row.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={!content || !preview || nothingToDo || apply.isPending}
            onClick={() => content && apply.mutate(content)}
          >
            {apply.isPending && <Loader2 className="animate-spin" />}
            {nothingToDo ? 'Niente da importare' : 'Importa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
