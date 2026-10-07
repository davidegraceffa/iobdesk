import type { AppliedCvEdit, GeneratedCvDetail } from '@jobagg/shared';
import { diffWords } from 'diff';
import { Check, Loader2, Pencil, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { EditChange } from '@/lib/api';
import { cn } from '@/lib/utils';

const OP_LABEL: Record<AppliedCvEdit['op'], string> = {
  replace: 'Testo riformulato',
  reorder: 'Riordino',
  remove: 'Paragrafo rimosso',
  insert_after: 'Paragrafo aggiunto',
};

/** Diff evidenziato parola per parola tra testo originale e testo proposto. */
export function Diff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <div className="grid gap-2 text-sm">
      <p className="rounded-md border p-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Prima</span>
        {parts
          .filter((p) => !p.added)
          .map((p, i) => (
            <span key={i} className={cn(p.removed && 'rounded-sm bg-diff-removed line-through decoration-1')}>
              {p.value}
            </span>
          ))}
      </p>
      <p className="rounded-md border p-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Dopo</span>
        {parts
          .filter((p) => !p.removed)
          .map((p, i) => (
            <span key={i} className={cn(p.added && 'rounded-sm bg-diff-added font-medium')}>
              {p.value}
            </span>
          ))}
      </p>
    </div>
  );
}

function EditCard({
  edit,
  cv,
  busy,
  onChange,
}: {
  edit: AppliedCvEdit;
  cv: GeneratedCvDetail;
  busy: boolean;
  onChange: (change: EditChange) => void;
}) {
  const [editing, setEditing] = useState(false);
  const proposed = edit.op === 'replace' || edit.op === 'insert_after' ? edit.newText : '';
  const current = edit.op === 'replace' || edit.op === 'insert_after' ? (edit.manualText ?? edit.newText) : '';
  const [draft, setDraft] = useState(current);
  const rejected = edit.status === 'rejected';
  const original = (id: string) => cv.originals[id]?.text ?? '';

  return (
    <li className={cn('grid gap-2.5 rounded-lg border p-3', rejected && 'bg-muted/50')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{OP_LABEL[edit.op]}</Badge>
        {rejected ? (
          <Badge variant="muted">Rifiutata: resta il testo originale</Badge>
        ) : (
          <Badge variant="success">Applicata</Badge>
        )}
        {edit.manualText && <Badge variant="outline">Ritoccata a mano</Badge>}
      </div>

      {edit.op === 'replace' && <Diff before={original(edit.paragraphId)} after={current} />}
      {edit.op === 'insert_after' && (
        <div className="grid gap-2 text-sm">
          <p className="text-xs text-muted-foreground">Dopo: “{original(edit.afterParagraphId).slice(0, 90)}…”</p>
          <p className="rounded-md border bg-diff-added/60 p-2">{current}</p>
        </div>
      )}
      {edit.op === 'remove' && (
        <p className="rounded-md border bg-diff-removed/60 p-2 text-sm line-through decoration-1">
          {original(edit.paragraphId)}
        </p>
      )}
      {edit.op === 'reorder' && (
        <ol className="list-decimal rounded-md border p-2 pl-7 text-sm">
          {edit.paragraphIds.map((id) => (
            <li key={id}>{original(id)}</li>
          ))}
        </ol>
      )}

      {edit.reason && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Motivo:</span> {edit.reason}
        </p>
      )}

      {editing && (
        <div className="grid gap-2">
          <Label htmlFor={`edit-${edit.id}`}>Testo del paragrafo</Label>
          <Textarea
            id={`edit-${edit.id}`}
            rows={4}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            I ritocchi manuali non passano dal controllo anti-invenzione: scrivi solo ciò che è vero.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => {
                onChange({
                  editId: edit.id,
                  status: 'accepted',
                  manualText: draft.trim() === proposed ? null : draft.trim(),
                });
                setEditing(false);
              }}
            >
              Applica il mio testo
            </Button>
            {edit.manualText && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  onChange({ editId: edit.id, manualText: null });
                  setDraft(proposed);
                  setEditing(false);
                }}
              >
                <RotateCcw /> Torna al testo proposto
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap gap-2">
          {rejected ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onChange({ editId: edit.id, status: 'accepted' })}
            >
              <Check /> Accetta
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onChange({ editId: edit.id, status: 'rejected' })}
            >
              <X /> Rifiuta
            </Button>
          )}
          {(edit.op === 'replace' || edit.op === 'insert_after') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(current);
                setEditing(true);
              }}
            >
              <Pencil /> Modifica a mano
            </Button>
          )}
          {busy && (
            <Loader2
              className="size-4 animate-spin self-center text-muted-foreground"
              aria-label="Aggiornamento dell’anteprima"
            />
          )}
        </div>
      )}
    </li>
  );
}

function sectionOf(edit: AppliedCvEdit, cv: GeneratedCvDetail): string {
  const id =
    edit.op === 'replace' || edit.op === 'remove'
      ? edit.paragraphId
      : edit.op === 'insert_after'
        ? edit.afterParagraphId
        : edit.paragraphIds[0];
  return (id && cv.originals[id]?.sectionTitle) || 'Altro';
}

/** Pannello "Modifiche": elenco per sezione con prima/dopo, motivo e pulsanti accetta/rifiuta/ritocca. */
export function EditsPanel({
  cv,
  busy,
  onChange,
}: {
  cv: GeneratedCvDetail;
  busy: boolean;
  onChange: (change: EditChange) => void;
}) {
  if (cv.edits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Il modello non ha proposto modifiche applicabili: il CV coincide con quello base.
      </p>
    );
  }
  const groups = new Map<string, AppliedCvEdit[]>();
  for (const edit of cv.edits) {
    const key = sectionOf(edit, cv);
    groups.set(key, [...(groups.get(key) ?? []), edit]);
  }
  return (
    <div className="grid gap-5">
      {[...groups.entries()].map(([section, edits]) => (
        <section key={section} className="grid gap-2">
          <h3 className="text-sm font-semibold">{section}</h3>
          <ul className="grid gap-2">
            {edits.map((edit) => (
              <EditCard key={edit.id} edit={edit} cv={cv} busy={busy} onChange={onChange} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
