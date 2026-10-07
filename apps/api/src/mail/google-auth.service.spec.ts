import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../config/env';
import { GMAIL_SCOPE, GoogleAuthError, GoogleAuthService } from './google-auth.service';

const service = (overrides: Partial<ReturnType<typeof loadEnv>> = {}) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'google-auth-'));
  const auth = new GoogleAuthService({
    ...loadEnv(),
    stateDir,
    publicUrl: 'http://127.0.0.1:8090',
    google: { clientId: 'client-id', clientSecret: 'client-secret' },
    ...overrides,
  });
  return { auth, tokenFile: join(stateDir, 'google-token.json') };
};

describe('GoogleAuthService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('senza client OAuth in .env non è configurato e non avvia il collegamento', () => {
    const { auth } = service({ google: { clientId: '', clientSecret: '' } });
    expect(auth.state()).toMatchObject({ configured: false, connected: false });
    expect(() => auth.startLogin()).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('chiede solo la lettura di Gmail, con PKCE e ritorno su loopback', () => {
    const { auth } = service();
    const url = new URL(auth.startLogin());
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPE);
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8090/api/mail/oauth/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.toString()).not.toContain('client-secret');
  });

  it('rifiuta un ritorno con state sconosciuto (o già usato)', async () => {
    const { auth } = service();
    await expect(auth.completeLogin('sconosciuto', 'codice')).rejects.toThrow(/scaduta o non valida/);
  });

  it('completa il collegamento: token nel file di stato (0600), mai altrove; lo state vale una volta sola', async () => {
    const { auth, tokenFile } = service();
    const state = new URL(auth.startLogin()).searchParams.get('state')!;
    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = (async (url: string, init?: { body?: URLSearchParams }) => {
      calls.push({ url: String(url), body: init?.body?.toString() ?? '' });
      if (String(url).includes('/token')) {
        return Response.json({ access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: GMAIL_SCOPE });
      }
      return Response.json({ emailAddress: 'me@example.com' });
    }) as never;

    await auth.completeLogin(state, 'codice');
    expect(calls[0]!.body).toContain('grant_type=authorization_code');
    expect(calls[0]!.body).toContain('code_verifier=');
    expect(auth.state()).toMatchObject({ connected: true, account: 'me@example.com', needsReconnect: false });
    expect(JSON.stringify(auth.state())).not.toContain('rt');
    expect(JSON.parse(readFileSync(tokenFile, 'utf8'))).toMatchObject({ refresh_token: 'rt' });
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    // access token già in memoria: nessuna nuova richiesta
    expect(await auth.accessToken()).toBe('at');
    expect(calls).toHaveLength(2);
    await expect(auth.completeLogin(state, 'codice')).rejects.toThrow(/scaduta o non valida/);
  });

  it('refresh token rifiutato da Google: il collegamento risulta da rifare', async () => {
    const { auth, tokenFile } = service();
    writeFileSync(tokenFile, JSON.stringify({ refresh_token: 'rt', connectedAt: '2026-10-01T00:00:00.000Z' }));
    expect(auth.isConnected()).toBe(true);
    global.fetch = (async () => Response.json({ error: 'invalid_grant' }, { status: 400 })) as never;

    await expect(auth.accessToken()).rejects.toBeInstanceOf(GoogleAuthError);
    expect(auth.state()).toMatchObject({ connected: false, needsReconnect: true });
  });

  it('scollegare cancella il token locale', async () => {
    const { auth, tokenFile } = service();
    writeFileSync(tokenFile, JSON.stringify({ refresh_token: 'rt', connectedAt: '2026-10-01T00:00:00.000Z' }));
    global.fetch = (async () => new Response('{}')) as never;
    await auth.disconnect();
    expect(auth.state()).toMatchObject({ connected: false, needsReconnect: false, account: null });
  });
});
