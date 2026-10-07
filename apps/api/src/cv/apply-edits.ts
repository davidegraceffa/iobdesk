import type { AppliedCvEdit } from '@jobagg/shared';
import { DocxDocument, DocxEditError } from './docx/docx-document';

export interface ApplyResult {
  buffer: Buffer;
  /** modifiche che il documento non ha potuto ricevere (es. paragrafi in blocchi diversi) */
  failed: Array<{ editId: string; reason: string }>;
  finalText: string;
}

const ORDER: Record<AppliedCvEdit['op'], number> = { replace: 0, reorder: 1, insert_after: 2, remove: 3 };

/**
 * Applica al DOCX base le modifiche accettate (quelle rifiutate dall'utente vengono saltate:
 * il paragrafo resta com'è nell'originale). Si riparte sempre dal file base, mai da un CV già generato.
 */
export async function applyEditsToDocx(baseDocx: Buffer, edits: AppliedCvEdit[]): Promise<ApplyResult> {
  const doc = await DocxDocument.load(baseDocx);
  const failed: ApplyResult['failed'] = [];
  const active = edits.filter((e) => e.status === 'accepted').sort((a, b) => ORDER[a.op] - ORDER[b.op]);

  for (const edit of active) {
    try {
      if (edit.op === 'replace') doc.replaceText(edit.paragraphId, edit.manualText?.trim() || edit.newText);
      else if (edit.op === 'reorder') doc.reorder(edit.paragraphIds);
      else if (edit.op === 'insert_after') {
        doc.insertAfter(edit.afterParagraphId, edit.cloneStyleFrom, edit.manualText?.trim() || edit.newText);
      } else doc.remove(edit.paragraphId);
    } catch (err) {
      if (!(err instanceof DocxEditError)) throw err;
      failed.push({ editId: edit.id, reason: err.message });
    }
  }
  return { buffer: await doc.toBuffer(), failed, finalText: doc.fullText() };
}
