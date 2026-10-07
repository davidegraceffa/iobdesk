import { EXTERNAL_LLM_PROVIDERS, LLM_PROVIDERS } from '@jobagg/shared';

/**
 * Variabili d'ambiente. I segreti (token Telegram, credenziali IMAP, client OAuth Google, chiavi LLM) vivono solo qui:
 * non finiscono mai nel database né nelle risposte dell'API.
 */
export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  configDir: string;
  cvDataDir: string;
  /** file di stato che non devono finire nel database (es. l'autorizzazione Google) */
  stateDir: string;
  /** indirizzo a cui il browser raggiunge l'app: serve per il ritorno dall'autorizzazione Google */
  publicUrl: string;
  gotenbergUrl: string;
  ollamaUrl: string;
  /** servizio locale di trascrizione (Whisper) per le risposte vocali dei colloqui simulati */
  whisperUrl: string;
  piperUrl: string;
  /** true quando il processo è la CLI: niente scheduler né worker delle code */
  cliMode: boolean;
  telegram: { botToken: string; chatId: string };
  imap: { host: string; port: number; user: string; password: string; mailbox: string };
  /** client OAuth di tipo "App desktop" per leggere Gmail in sola lettura */
  google: { clientId: string; clientSecret: string };
  /** se valorizzato forza il provider LLM scelto nelle impostazioni ("mock" solo per i test) */
  llmProviderOverride: string;
  anthropicApiKey: string;
  /** alternativa alla chiave API per il Claude Agent SDK: token generato con `claude setup-token` */
  claudeCodeOauthToken: string;
  openaiApiKey: string;
}

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export function loadEnv(): Env {
  const override = str('LLM_PROVIDER').toLowerCase();
  const allowed: string[] = [...LLM_PROVIDERS, 'mock'];
  return {
    nodeEnv: str('NODE_ENV', 'development'),
    port: Number(str('PORT', '3000')) || 3000,
    databaseUrl: str('DATABASE_URL'),
    configDir: str('CONFIG_DIR', '/config'),
    cvDataDir: str('CV_DATA_DIR', '/data/cv'),
    stateDir: str('STATE_DIR', '/data/state'),
    publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:8080').replace(/\/$/, ''),
    gotenbergUrl: str('GOTENBERG_URL', 'http://gotenberg:3000').replace(/\/$/, ''),
    ollamaUrl: str('OLLAMA_URL', 'http://ollama:11434').replace(/\/$/, ''),
    whisperUrl: str('WHISPER_URL', 'http://whisper:9000').replace(/\/$/, ''),
    piperUrl: str('PIPER_URL', 'http://piper:5000').replace(/\/$/, ''),
    cliMode: str('APP_MODE') === 'cli',
    telegram: { botToken: str('TELEGRAM_BOT_TOKEN'), chatId: str('TELEGRAM_CHAT_ID') },
    imap: {
      host: str('IMAP_HOST'),
      port: Number(str('IMAP_PORT', '993')) || 993,
      user: str('IMAP_USER'),
      password: str('IMAP_PASSWORD'),
      mailbox: str('IMAP_MAILBOX', 'job-alerts'),
    },
    google: { clientId: str('GOOGLE_CLIENT_ID'), clientSecret: str('GOOGLE_CLIENT_SECRET') },
    llmProviderOverride: allowed.includes(override) ? override : '',
    anthropicApiKey: str('ANTHROPIC_API_KEY'),
    claudeCodeOauthToken: str('CLAUDE_CODE_OAUTH_TOKEN'),
    openaiApiKey: str('OPENAI_API_KEY'),
  };
}

export const ENV = Symbol('ENV');

export function isExternalProvider(provider: string): boolean {
  return EXTERNAL_LLM_PROVIDERS.includes(provider);
}
