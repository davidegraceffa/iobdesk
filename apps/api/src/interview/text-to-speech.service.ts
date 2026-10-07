import { BadGatewayException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

const CHECK_TTL_MS = 15_000;

/**
 * Voce dell'intervistatore con un servizio Piper locale (container "piper", profilo `tts`): sintesi neurale
 * sul proprio computer. Le lingue disponibili sono quelle delle voci scaricate (nomi tipo `it_IT-paola-medium`).
 */
@Injectable()
export class TextToSpeechService {
  private checked: { at: number; voices: string[] } | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async voices(): Promise<string[]> {
    if (this.checked && Date.now() - this.checked.at < CHECK_TTL_MS) return this.checked.voices;
    let voices: string[] = [];
    try {
      const response = await fetch(`${this.env.piperUrl}/voices`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) voices = Object.keys((await response.json()) as Record<string, unknown>);
    } catch {
      voices = [];
    }
    this.checked = { at: Date.now(), voices };
    return voices;
  }

  /** Lingue (codice a due lettere) per cui c'è una voce. */
  async languages(): Promise<string[]> {
    return [...new Set((await this.voices()).map((voice) => voice.slice(0, 2).toLowerCase()))];
  }

  /** Audio WAV del testo pronunciato nella lingua indicata. */
  async synthesize(text: string, language: string): Promise<Buffer> {
    const voice = (await this.voices()).find((name) => name.toLowerCase().startsWith(`${language}_`));
    if (!voice) {
      throw new ServiceUnavailableException(
        'Voce non disponibile per questa lingua: avvia il servizio con  docker compose --profile tts up -d',
      );
    }
    let response: Response;
    try {
      response = await fetch(`${this.env.piperUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      this.checked = null;
      throw new ServiceUnavailableException('Sintesi vocale non disponibile');
    }
    if (!response.ok) throw new BadGatewayException(`Sintesi vocale non riuscita (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
}
