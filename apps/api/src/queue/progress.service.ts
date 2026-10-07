import { Injectable } from '@nestjs/common';
import type { CvProgressEvent } from '@jobagg/shared';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

/** Avanzamento dei lavori in coda, inoltrato alla UI tramite Server-Sent Events. */
@Injectable()
export class ProgressService {
  private readonly events$ = new Subject<CvProgressEvent>();

  emit(event: CvProgressEvent): void {
    this.events$.next(event);
  }

  forCv(generatedCvId: string): Observable<CvProgressEvent> {
    return this.events$.pipe(filter((e) => e.generatedCvId === generatedCvId));
  }
}
