import type { CvProgressEvent, CvProgressStep } from '@jobagg/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

export const CV_STEPS: Array<{ step: CvProgressStep; label: string }> = [
  { step: 'analysis', label: 'Analisi dell’annuncio' },
  { step: 'adaptation', label: 'Adattamento dei contenuti' },
  { step: 'layout', label: 'Impaginazione' },
  { step: 'preview', label: 'Anteprima' },
];

const ORDER: CvProgressStep[] = ['queued', 'analysis', 'adaptation', 'layout', 'preview', 'ready'];

export function stepIndex(step: CvProgressStep): number {
  return ORDER.indexOf(step);
}

/**
 * Avanzamento della generazione via Server-Sent Events. Se la connessione cade, EventSource
 * si ricollega da solo e l'API rimanda subito lo stato corrente.
 */
export function useCvProgress(generatedCvId: string | null): CvProgressEvent | null {
  const [event, setEvent] = useState<CvProgressEvent | null>(null);

  useEffect(() => {
    setEvent(null);
    if (!generatedCvId || typeof EventSource === 'undefined') return;
    const source = new EventSource(api.cv.eventsUrl(generatedCvId));
    source.onmessage = (message) => {
      try {
        const next = JSON.parse(message.data as string) as CvProgressEvent;
        setEvent((current) => {
          // "ready"/"failed" chiudono; per il resto non si torna mai indietro (eventi fuori ordine)
          if (next.step === 'failed' || next.step === 'ready') return next;
          if (current && stepIndex(next.step) < stepIndex(current.step)) return current;
          return next;
        });
        if (next.step === 'ready' || next.step === 'failed') source.close();
      } catch {
        // messaggio non interpretabile: ignorato
      }
    };
    return () => source.close();
  }, [generatedCvId]);

  return event;
}
