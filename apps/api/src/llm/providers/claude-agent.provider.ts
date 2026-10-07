import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmError, type LlmProviderClient, type LlmRequest } from '../llm.types';

export interface ClaudeAuth {
  /** chiave della Claude Console (ANTHROPIC_API_KEY) */
  apiKey: string;
  /** token a lunga durata generato con `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) */
  oauthToken: string;
}

type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

/** Tempo massimo per una risposta (le modifiche al CV possono richiedere qualche minuto). */
const TIMEOUT_MS = 10 * 60_000;

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: 'Credenziali Claude non valide: controlla ANTHROPIC_API_KEY o CLAUDE_CODE_OAUTH_TOKEN',
  oauth_org_not_allowed: 'L’organizzazione del token Claude non è autorizzata',
  billing_error: 'Problema di fatturazione sull’account Claude',
  rate_limit: 'Limite di utilizzo di Claude raggiunto: riprova più tardi',
  overloaded: 'Claude è sovraccarico: riprova più tardi',
  model_not_found: 'Modello Claude non trovato',
};

async function loadQuery(): Promise<QueryFn> {
  // il pacchetto è un modulo ES: si carica alla prima richiesta, non all'avvio dell'app
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query;
}

/**
 * Provider esterno: annunci e CV vengono inviati ad Anthropic tramite il Claude Agent SDK.
 * La UI lo dichiara e chiede un consenso esplicito prima del primo utilizzo.
 *
 * L'SDK avvia Claude Code come sottoprocesso: qui lo si usa come semplice completamento a un turno,
 * senza strumenti, senza impostazioni lette dal disco e senza sessioni salvate. Il sottoprocesso riceve
 * solo le variabili d'ambiente indispensabili, non i segreti dell'applicazione.
 */
export class ClaudeAgentProvider implements LlmProviderClient {
  readonly id = 'anthropic';

  constructor(
    private readonly auth: ClaudeAuth,
    private readonly load: () => Promise<QueryFn> = loadQuery,
  ) {}

  private options(model: string, request: LlmRequest, abortController: AbortController, stream = false): Options {
    const workDir = join(tmpdir(), 'jobagg-claude');
    const configDir = join(workDir, 'config');
    mkdirSync(configDir, { recursive: true });
    return {
      model,
      systemPrompt: request.system,
      // turni di conversazione: niente ragionamento esteso, la risposta deve arrivare subito
      ...(request.fast ? { thinking: { type: 'disabled' as const } } : {}),
      // nessuno strumento: il modello può solo rispondere
      tools: [],
      allowedTools: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      // testo man mano che viene scritto (conversazione a voce)
      ...(stream ? { includePartialMessages: true } : {}),
      // isolamento: niente impostazioni, CLAUDE.md o memoria dal filesystem, nessuna sessione su disco
      settingSources: [],
      persistSession: false,
      cwd: workDir,
      abortController,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        // solo la chiamata al modello: niente telemetria, aggiornamenti automatici o segnalazione errori
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxTokens ?? 16000),
        CLAUDE_CODE_MAX_RETRIES: '2',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'iobdesk/0.1.0',
        // una sola credenziale: se c'è il token dell'abbonamento vale quello, altrimenti la chiave API
        ...(this.auth.oauthToken
          ? { CLAUDE_CODE_OAUTH_TOKEN: this.auth.oauthToken }
          : { ANTHROPIC_API_KEY: this.auth.apiKey }),
      },
    };
  }

  async complete(model: string, request: LlmRequest, onText?: (delta: string) => void): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);
    let assistantError: string | undefined;
    try {
      const query = await this.load();
      for await (const message of query({
        prompt: request.user,
        options: this.options(model, request, abortController, !!onText),
      })) {
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText?.(event.delta.text);
          continue;
        }
        if (message.type === 'assistant' && message.error) assistantError = message.error;
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success' || message.is_error) {
          const detail = message.subtype === 'success' ? message.result : message.errors.join('; ');
          throw new LlmError(
            (assistantError && ASSISTANT_ERRORS[assistantError]) ||
              `Errore di Claude (${assistantError ?? message.subtype}): ${detail || 'nessun dettaglio'}`,
          );
        }
        if (message.stop_reason === 'refusal') {
          throw new LlmError('Il modello ha rifiutato la richiesta (stop_reason: refusal)');
        }
        if (message.stop_reason === 'max_tokens') {
          throw new LlmError('Risposta del modello troncata (max_tokens raggiunto)');
        }
        return message.result;
      }
      throw new LlmError('Claude non ha restituito alcuna risposta');
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (abortController.signal.aborted) {
        throw new LlmError(`Claude non ha risposto entro ${TIMEOUT_MS / 60_000} minuti`);
      }
      throw new LlmError(`Claude Agent SDK: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
