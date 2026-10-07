import { Injectable } from '@nestjs/common';
import { GoogleAuthError, GoogleAuthService, explainGoogleError } from './google-auth.service';
import { messageToItem, type GmailMessage } from './gmail-message';
import type { MailItem } from './parse';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** richieste in parallelo: ben dentro la quota per utente */
const BATCH = 10;

/**
 * Accesso in sola lettura alla casella: cerca e scarica i messaggi, non li segna come letti
 * né li modifica. Il contenuto resta nel container: non viene salvato né inviato ad altri servizi.
 */
@Injectable()
export class GmailClient {
  constructor(private readonly auth: GoogleAuthService) {}

  private async get<T>(path: string, params: Record<string, string>, retried = false): Promise<T> {
    const token = await this.auth.accessToken();
    const response = await fetch(`${API}${path}?${new URLSearchParams(params).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 && !retried) {
      this.auth.dropAccessToken();
      return this.get<T>(path, params, true);
    }
    if ((response.status === 429 || response.status >= 500) && !retried) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return this.get<T>(path, params, true);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401) throw new GoogleAuthError(`Gmail ha rifiutato l'accesso: ${message}`);
      throw new Error(explainGoogleError(`Gmail API: ${message}`));
    }
    return (await response.json()) as T;
  }

  /** Esegue una ricerca Gmail e scarica i messaggi trovati (al massimo `max`). */
  async search(query: string, max: number, timeZone: string): Promise<MailItem[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page: { messages?: Array<{ id?: string }>; nextPageToken?: string } = await this.get('/messages', {
        q: query,
        maxResults: String(Math.min(100, max - ids.length)),
        ...(pageToken ? { pageToken } : {}),
      });
      for (const m of page.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);

    const out: MailItem[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = await Promise.all(
        ids.slice(i, i + BATCH).map((id) => this.get<GmailMessage>(`/messages/${id}`, { format: 'full' })),
      );
      for (const message of chunk) {
        const item = messageToItem(message, timeZone);
        if (item) out.push(item);
      }
    }
    return out;
  }
}
