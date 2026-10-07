import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, type Env } from '../config/env';

/** Sola lettura della posta: l'app non chiede mai altro. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const TOKEN_FILE = 'google-token.json';
const PENDING_TTL_MS = 10 * 60_000;

export const RECONNECT_HINT =
  'L’autorizzazione Google è scaduta o è stata revocata: ricollega Gmail dal Profilo. ' +
  'Se succede ogni 7 giorni, l’app OAuth è in modalità "Test" (vedi docs/GUIDA.md).';

interface StoredToken {
  refresh_token: string;
  scope?: string;
  /** indirizzo della casella collegata, mostrato nell'interfaccia */
  account?: string;
  connectedAt: string;
  /** Google ha rifiutato il refresh token (scaduto o revocato): serve un nuovo collegamento */
  invalid?: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** L'autorizzazione Google manca, è scaduta o è stata revocata. */
export class GoogleAuthError extends Error {}

export interface GoogleAuthState {
  configured: boolean;
  connected: boolean;
  /** c'era un collegamento, ma Google non lo accetta più */
  needsReconnect: boolean;
  account: string | null;
  connectedAt: string | null;
  redirectUri: string;
}

/**
 * OAuth per le app installate, con ritorno su loopback: Google rimanda il browser a
 * `http://127.0.0.1:<porta>/api/mail/oauth/callback`, cioè a questa stessa app. Il client OAuth sta in `.env`,
 * il refresh token in un file del volume di stato (mai nel database, mai nelle risposte dell'API).
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly pending = new Map<string, { verifier: string; expiresAt: number }>();
  private access: { token: string; expiresAt: number } | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get redirectUri(): string {
    return `${this.env.publicUrl}/api/mail/oauth/callback`;
  }

  private get tokenPath(): string {
    return join(this.env.stateDir, TOKEN_FILE);
  }

  isConfigured(): boolean {
    return !!this.env.google.clientId && !!this.env.google.clientSecret;
  }

  private readToken(): StoredToken | null {
    if (!existsSync(this.tokenPath)) return null;
    try {
      const token = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as StoredToken;
      return token.refresh_token ? token : null;
    } catch {
      return null;
    }
  }

  private writeToken(token: StoredToken): void {
    mkdirSync(this.env.stateDir, { recursive: true });
    writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
    chmodSync(this.tokenPath, 0o600);
  }

  isConnected(): boolean {
    const token = this.readToken();
    return this.isConfigured() && !!token && !token.invalid;
  }

  state(): GoogleAuthState {
    const token = this.readToken();
    const configured = this.isConfigured();
    return {
      configured,
      connected: configured && !!token && !token.invalid,
      needsReconnect: !!token?.invalid,
      account: token?.account ?? null,
      connectedAt: token?.connectedAt ?? null,
      redirectUri: this.redirectUri,
    };
  }

  /** URL della pagina di consenso Google (PKCE + state monouso). */
  startLogin(): string {
    if (!this.isConfigured()) {
      throw new BadRequestException('Mancano GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nel file .env');
    }
    const now = Date.now();
    for (const [key, value] of this.pending) if (value.expiresAt < now) this.pending.delete(key);
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    this.pending.set(state, { verifier, expiresAt: now + PENDING_TTL_MS });
    const params = new URLSearchParams({
      client_id: this.env.google.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      // chiede sempre il consenso: così Google restituisce un refresh token anche al secondo collegamento
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.google.clientId,
        client_secret: this.env.google.clientSecret,
        ...body,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok && !data.error) data.error = `HTTP ${response.status}`;
    return data;
  }

  /** Secondo passo del collegamento: scambia il codice ricevuto da Google con i token. */
  async completeLogin(state: string, code: string): Promise<void> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new BadRequestException('Richiesta di collegamento scaduta o non valida: riprova dal Profilo');
    }
    const data = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      redirect_uri: this.redirectUri,
    });
    if (data.error || !data.access_token) {
      throw new BadRequestException(`Google ha rifiutato il collegamento: ${data.error_description ?? data.error}`);
    }
    if (!data.refresh_token) {
      throw new BadRequestException('Google non ha restituito un refresh token: riprova il collegamento');
    }
    if (data.scope && !data.scope.split(' ').includes(GMAIL_SCOPE)) {
      throw new BadRequestException('Non hai concesso la lettura di Gmail: riprova e lascia selezionato il permesso');
    }
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    this.writeToken({
      refresh_token: data.refresh_token,
      scope: data.scope,
      account: await this.fetchAccount(data.access_token),
      connectedAt: new Date().toISOString(),
    });
    this.logger.log('Gmail collegata');
  }

  private async fetchAccount(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return undefined;
      return ((await response.json()) as { emailAddress?: string }).emailAddress;
    } catch {
      return undefined;
    }
  }

  /** Access token valido, rinnovato quando serve. */
  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - 60_000 > Date.now()) return this.access.token;
    const stored = this.readToken();
    if (!this.isConfigured() || !stored) throw new GoogleAuthError('Gmail non è collegata: collegala dal Profilo');
    if (stored.invalid) throw new GoogleAuthError(RECONNECT_HINT);
    const data = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
    if (data.error === 'invalid_grant') {
      this.writeToken({ ...stored, invalid: true });
      this.access = null;
      throw new GoogleAuthError(RECONNECT_HINT);
    }
    if (data.error || !data.access_token) {
      throw new Error(`Rinnovo dell'accesso a Google non riuscito: ${data.error_description ?? data.error}`);
    }
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.access.token;
  }

  /** Dopo un 401 dell'API: l'access token in memoria non è più buono. */
  dropAccessToken(): void {
    this.access = null;
  }

  /** Revoca l'autorizzazione presso Google (se possibile) e cancella il file locale. */
  async disconnect(): Promise<void> {
    const stored = this.readToken();
    this.access = null;
    if (stored && !stored.invalid) {
      try {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: stored.refresh_token }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        this.logger.warn(`Revoca presso Google non riuscita: ${(err as Error).message}`);
      }
    }
    rmSync(this.tokenPath, { force: true });
  }
}

/** Traduce gli errori più comuni dell'API Google in qualcosa su cui si può agire. */
export function explainGoogleError(message: string): string {
  if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return 'All’autorizzazione Google manca il permesso di lettura di Gmail: ricollega Gmail dal Profilo.';
  }
  if (/has not been used in project|is disabled/i.test(message)) {
    return 'Nel progetto Google Cloud va attivata la Gmail API (vedi docs/GUIDA.md).';
  }
  return message;
}
