import { LlmError, type LlmProviderClient, type LlmRequest } from '../llm.types';

/** Provider esterno: annunci e CV vengono inviati a OpenAI (consenso esplicito richiesto dalla UI). */
export class OpenAiProvider implements LlmProviderClient {
  readonly id = 'openai';

  constructor(private readonly apiKey: string) {}

  async complete(model: string, request: LlmRequest): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (response.status === 401) throw new LlmError('Chiave OPENAI_API_KEY non valida');
    if (response.status === 404) throw new LlmError(`Modello OpenAI "${model}" non trovato`);
    if (response.status === 429) throw new LlmError('Limite di richieste OpenAI raggiunto: riprova più tardi');
    if (!response.ok)
      throw new LlmError(`OpenAI ha risposto HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') throw new LlmError('Risposta del modello troncata');
    return choice?.message?.content ?? '';
  }
}
