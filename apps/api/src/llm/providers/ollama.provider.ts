import { LlmError, type LlmProviderClient, type LlmRequest } from '../llm.types';

/** LLM locale nel container `ollama` (profilo compose "llm"): nessun dato esce dalla macchina. */
export class OllamaProvider implements LlmProviderClient {
  readonly id = 'ollama';

  constructor(private readonly baseUrl: string) {}

  async complete(model: string, request: LlmRequest): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0.2, num_ctx: 16384 },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (err) {
      throw new LlmError(
        `Ollama non raggiungibile (${(err as Error).message}). Avvialo con: docker compose --profile llm up -d`,
      );
    }
    if (response.status === 404) {
      throw new LlmError(
        `Modello "${model}" non presente in Ollama. Scaricalo con: docker compose exec ollama ollama pull ${model}`,
      );
    }
    if (!response.ok)
      throw new LlmError(`Ollama ha risposto HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content ?? '';
  }
}
