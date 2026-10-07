import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { LlmError, type LlmRequest } from '../llm.types';
import { ClaudeAgentProvider } from './claude-agent.provider';

const request: LlmRequest = { task: 'score', system: 'Sei un valutatore.', user: 'Valuta questo annuncio.' };

function provider(messages: unknown[], auth = { apiKey: 'sk-test', oauthToken: '' }) {
  const calls: Array<{ prompt: string; options?: Options }> = [];
  const instance = new ClaudeAgentProvider(auth, async () => (params) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m as SDKMessage;
    })();
  });
  return { instance, calls };
}

const success = (extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"score": 80}',
  stop_reason: 'end_turn',
  ...extra,
});

describe('ClaudeAgentProvider', () => {
  const secret = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://segreto';
  });
  afterAll(() => {
    process.env.DATABASE_URL = secret;
  });

  it('un turno, nessuno strumento, nessuna impostazione dal disco; restituisce il testo del risultato', async () => {
    const { instance, calls } = provider([{ type: 'system', subtype: 'init' }, success()]);
    expect(await instance.complete('claude-opus-5-5', request)).toBe('{"score": 80}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toBe('Valuta questo annuncio.');
    expect(calls[0]!.options).toMatchObject({
      model: 'claude-opus-5-5',
      systemPrompt: 'Sei un valutatore.',
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      permissionMode: 'dontAsk',
    });
  });

  it('al sottoprocesso passano solo le credenziali Claude, non gli altri segreti dell’app', async () => {
    const { instance, calls } = provider([success()], { apiKey: 'sk-test', oauthToken: 'oauth-test' });
    await instance.complete('claude-opus-5-5', request);
    const env = calls[0]!.options!.env!;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('credenziali rifiutate: messaggio comprensibile', async () => {
    const { instance } = provider([
      { type: 'assistant', error: 'authentication_failed', message: {} },
      success({ is_error: true, result: 'Invalid API key' }),
    ]);
    await expect(instance.complete('claude-opus-5-5', request)).rejects.toThrow(/Credenziali Claude non valide/);
  });

  it('errori di esecuzione, rifiuti e risposte troncate diventano LlmError', async () => {
    const failed = provider([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]);
    await expect(failed.instance.complete('m', request)).rejects.toThrow(/error_during_execution.*boom/);
    await expect(provider([success({ stop_reason: 'refusal' })]).instance.complete('m', request)).rejects.toThrow(
      /rifiutato/,
    );
    await expect(provider([success({ stop_reason: 'max_tokens' })]).instance.complete('m', request)).rejects.toThrow(
      /troncata/,
    );
    await expect(provider([]).instance.complete('m', request)).rejects.toBeInstanceOf(LlmError);
  });

  it('un errore nell’avvio dell’SDK non esce come eccezione generica', async () => {
    const broken = new ClaudeAgentProvider({ apiKey: 'k', oauthToken: '' }, async () => {
      throw new Error('binario non trovato');
    });
    await expect(broken.complete('m', request)).rejects.toThrow(/Claude Agent SDK: binario non trovato/);
  });
});
