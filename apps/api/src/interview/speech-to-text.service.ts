import { BadGatewayException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { isPhantomTranscript, spokenText, type WhisperSegment } from './transcript-filter';

const CHECK_TTL_MS = 15_000;

/**
 * Trascrizione delle risposte vocali con un servizio Whisper locale (container "whisper", profilo `stt`):
 * l'audio resta su questo computer e non viene salvato.
 */
@Injectable()
export class SpeechToTextService {
  private checked: { at: number; ok: boolean } | null = null;
  private inFlight = 0;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async available(): Promise<boolean> {
    // mentre trascrive, Whisper non risponde ad altre richieste: il controllo andrebbe in timeout pur essendo attivo
    if (this.inFlight > 0) return true;
    if (this.checked && Date.now() - this.checked.at < CHECK_TTL_MS) return this.checked.ok;
    let ok: boolean;
    try {
      const response = await fetch(`${this.env.whisperUrl}/docs`, { signal: AbortSignal.timeout(2000) });
      ok = response.ok;
    } catch {
      ok = false;
    }
    this.checked = { at: Date.now(), ok };
    return ok;
  }

  /** `hint`: termini attesi (titolo del ruolo, tecnologie) che aiutano Whisper a scrivere bene i nomi propri. */
  async transcribe(audio: Buffer, mimeType: string, language: string, hint = ''): Promise<string> {
    const form = new FormData();
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio_file', new Blob([new Uint8Array(audio)], { type: mimeType }), `answer.${extension}`);
    // vad_filter: scarta i silenzi (pause lunghe mentre si pensa alla risposta)
    const params = new URLSearchParams({
      task: 'transcribe',
      language,
      output: 'json',
      encode: 'true',
      vad_filter: 'true',
      ...(hint ? { initial_prompt: hint } : {}),
    });
    let response: Response;
    this.inFlight++;
    try {
      response = await fetch(`${this.env.whisperUrl}/asr?${params.toString()}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch {
      this.checked = { at: Date.now(), ok: false };
      throw new ServiceUnavailableException(
        'Trascrizione non disponibile: avvia il servizio locale con  docker compose --profile stt up -d',
      );
    } finally {
      this.inFlight--;
    }
    this.checked = { at: Date.now(), ok: true };
    if (!response.ok) {
      throw new BadGatewayException(`Trascrizione non riuscita (HTTP ${response.status})`);
    }
    const body = (await response.json().catch(() => null)) as { text?: string; segments?: WhisperSegment[] } | null;
    const text = Array.isArray(body?.segments)
      ? spokenText(body.segments)
      : (body?.text ?? '').replace(/\s+/g, ' ').trim();
    // audio muto o solo rumore: Whisper ripete il suggerimento o una frase fatta, che non è la risposta
    return isPhantomTranscript(text, hint) ? '' : text;
  }
}
