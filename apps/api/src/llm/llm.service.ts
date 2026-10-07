import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Settings } from '@jobagg/shared';
import type { ZodType } from 'zod';
import { ENV, isExternalProvider, type Env } from '../config/env';
import { LlmError, type LlmProviderClient, type LlmRequest } from './llm.types';
import { ClaudeAgentProvider } from './providers/claude-agent.provider';
import { MockProvider } from './providers/mock.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiProvider } from './providers/openai.provider';

export interface LlmStatus {
  provider: string;
  model: string;
  enabled: boolean;
  external: boolean;
  forcedByEnv: boolean;
  consentGiven: boolean;
  ready: boolean;
  notReadyReason: string | null;
}

/** Estrae l'oggetto JSON dalla risposta, tollerando recinti ```json e testo attorno. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new LlmError('La risposta del modello non contiene un oggetto JSON');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new LlmError(`JSON non valido nella risposta del modello: ${(err as Error).message}`);
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Stato dell'LLM per le impostazioni date: provider effettivo e cosa manca per poterlo usare. */
  status(settings: Settings): LlmStatus {
    const cfg = settings.scoring.llm;
    const forcedByEnv = !!this.env.llmProviderOverride;
    const provider = this.env.llmProviderOverride || cfg.provider;
    const external = isExternalProvider(provider);
    let notReadyReason: string | null = null;
    if (!cfg.enabled) notReadyReason = 'LLM disattivato: attivalo dalla sezione Profilo → Avanzate';
    else if (provider === 'anthropic' && !this.env.anthropicApiKey && !this.env.claudeCodeOauthToken)
      notReadyReason = 'Manca ANTHROPIC_API_KEY (o CLAUDE_CODE_OAUTH_TOKEN) nel file .env';
    else if (provider === 'openai' && !this.env.openaiApiKey) notReadyReason = 'Manca OPENAI_API_KEY nel file .env';
    else if (external && !cfg.external_consent)
      notReadyReason = 'Serve il consenso esplicito all’invio dei dati a un provider esterno';
    return {
      provider,
      model: cfg.model,
      enabled: cfg.enabled,
      external,
      forcedByEnv,
      consentGiven: cfg.external_consent,
      ready: notReadyReason === null,
      notReadyReason,
    };
  }

  /** Modello per le risposte immediate: quello indicato nel Profilo, altrimenti uno rapido del provider. */
  fastModel(settings: Settings): string {
    const cfg = settings.scoring.llm;
    if (cfg.fast_model) return cfg.fast_model;
    const provider = this.env.llmProviderOverride || cfg.provider;
    return provider === 'anthropic' ? 'claude-sonnet-5-5' : cfg.model;
  }

  private client(provider: string): LlmProviderClient {
    switch (provider) {
      case 'ollama':
        return new OllamaProvider(this.env.ollamaUrl);
      case 'anthropic':
        return new ClaudeAgentProvider({
          apiKey: this.env.anthropicApiKey,
          oauthToken: this.env.claudeCodeOauthToken,
        });
      case 'openai':
        return new OpenAiProvider(this.env.openaiApiKey);
      case 'mock':
        return new MockProvider();
      default:
        throw new LlmError(`Provider LLM sconosciuto: ${provider}`);
    }
  }

  /**
   * Chiede al modello una risposta JSON e la valida con Zod. Se la risposta non rispetta
   * lo schema riprova una volta indicando al modello l'errore.
   * `onText` riceve la risposta accumulata mentre viene scritta (solo al primo tentativo, se il provider lo sa fare).
   */
  async completeJson<T>(
    settings: Settings,
    schema: ZodType<T>,
    request: LlmRequest,
    onText?: (accumulated: string) => void,
  ): Promise<T> {
    const status = this.status(settings);
    if (!status.ready) throw new LlmError(status.notReadyReason ?? 'LLM non disponibile');
    const client = this.client(status.provider);

    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const user =
        attempt === 0
          ? request.user
          : `${request.user}\n\nLa risposta precedente non era valida (${lastError}). Rispondi SOLO con un oggetto JSON conforme allo schema richiesto.`;
      let accumulated = '';
      const text = await client.complete(
        request.fast ? this.fastModel(settings) : status.model,
        { ...request, user },
        onText && attempt === 0
          ? (delta) => {
              accumulated += delta;
              onText(accumulated);
            }
          : undefined,
      );
      try {
        const parsed = schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
      } catch (err) {
        lastError = (err as Error).message;
      }
      this.logger.warn(`Risposta LLM non valida (tentativo ${attempt + 1}): ${lastError}`);
    }
    throw new LlmError(`Il modello non ha restituito un JSON valido: ${lastError}`);
  }
}
