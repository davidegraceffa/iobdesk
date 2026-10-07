import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const SHORTCUTS: Array<[string, string]> = [
  ['j / k', 'Annuncio successivo / precedente'],
  ['Invio', 'Apri il dettaglio dell’annuncio selezionato'],
  ['s', 'Salva / rimuovi dai salvati'],
  ['a', 'Segna come candidato'],
  ['d', 'Scarta / ripristina'],
  ['o', 'Apri l’annuncio originale sulla fonte'],
  ['c', 'Genera CV su misura'],
  ['/', 'Vai alla ricerca'],
  ['?', 'Mostra queste scorciatoie'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scorciatoie da tastiera</DialogTitle>
          <DialogDescription>
            Attive nella lista annunci e nel dettaglio, quando non stai scrivendo in un campo.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
