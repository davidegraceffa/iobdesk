import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  acceptedRegionsFor,
  diffSettings,
  getCountry,
  isOnboardingComplete,
  listCountries,
  resolveTimezone,
  tzOffsetHours,
  type CountryDto,
  type ProfileHistoryEntry,
  type ProfileImportPreview,
  type ProfilePreviewResult,
  type ProfileResponse,
} from '@jobagg/shared';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ENV, type Env } from '../config/env';
import { SettingsService, type SettingsSnapshot } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { PipelineService } from '../pipeline/pipeline.service';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly pipeline: PipelineService,
  ) {}

  private toResponse(snapshot: SettingsSnapshot): ProfileResponse {
    const { settings } = snapshot;
    const country = getCountry(settings.user.country);
    const timezone = resolveTimezone(settings.user.country, settings.user.timezone);
    const llm = this.llm.status(settings);
    return {
      settings,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt?.toISOString() ?? null,
      onboardingComplete: isOnboardingComplete(settings),
      derived: {
        acceptedRegions: country
          ? [
              ...new Set([
                ...acceptedRegionsFor(country.code),
                ...settings.location.extra_accepted_regions.map((r) => r.toLowerCase()),
              ]),
            ]
          : [],
        timezone,
        utcOffsetHours: tzOffsetHours(timezone),
        currency: country?.currency ?? null,
        eu: country?.eu ?? false,
        countryName: country?.name ?? null,
      },
      // i segreti restano in .env: qui si dice solo se sono configurati
      secrets: {
        telegram: !!this.env.telegram.botToken && !!this.env.telegram.chatId,
        imap: !!this.env.imap.host && !!this.env.imap.user && !!this.env.imap.password,
        anthropic: !!this.env.anthropicApiKey || !!this.env.claudeCodeOauthToken,
        openai: !!this.env.openaiApiKey,
      },
      llm: {
        provider: llm.provider,
        model: llm.model,
        enabled: llm.enabled,
        external: llm.external,
        forcedByEnv: llm.forcedByEnv,
        ready: llm.ready,
        notReadyReason: llm.notReadyReason,
      },
    };
  }

  async get(): Promise<ProfileResponse> {
    return this.toResponse(await this.settings.snapshot());
  }

  async save(input: unknown, reason = 'save'): Promise<ProfileResponse> {
    return this.toResponse(await this.settings.save(input, reason));
  }

  async history(): Promise<ProfileHistoryEntry[]> {
    return (await this.settings.history()).map((h) => ({ ...h, savedAt: h.savedAt.toISOString() }));
  }

  async restore(id: string): Promise<ProfileResponse> {
    return this.toResponse(await this.settings.restore(id));
  }

  async export(format: 'yaml' | 'json'): Promise<string> {
    const settings = await this.settings.get();
    if (format === 'json') return `${JSON.stringify(settings, null, 2)}\n`;
    return `# Impostazioni Iobdesk esportate il ${new Date().toISOString()}\n${stringifyYaml(settings)}`;
  }

  /** Interpreta il contenuto di un file di impostazioni (YAML o JSON; lo YAML è un superset del JSON). */
  private parseContent(content: unknown): unknown {
    if (typeof content !== 'string') return content;
    try {
      return parseYaml(content);
    } catch (err) {
      throw new BadRequestException({
        message: 'File non leggibile: non è YAML né JSON valido',
        errors: [{ path: '', message: (err as Error).message }],
      });
    }
  }

  /** Import con anteprima: con `dryRun` restituisce solo errori e differenze, senza salvare. */
  async import(content: unknown, dryRun: boolean): Promise<ProfileImportPreview> {
    const parsed = this.parseContent(content);
    const result = this.settings.validate(parsed);
    if (!result.success) return { valid: false, errors: result.errors, changes: [] };
    const current = await this.settings.get();
    const changes = diffSettings(current, result.settings);
    if (!dryRun) await this.settings.save(result.settings, 'import');
    return { valid: true, errors: [], changes, settings: result.settings };
  }

  /** Anteprima di quanti annunci passerebbero i nuovi criteri, prima di salvare. */
  async preview(input: unknown): Promise<ProfilePreviewResult> {
    const result = this.settings.validate(input);
    if (!result.success) {
      throw new BadRequestException({ message: 'Impostazioni non valide', errors: result.errors });
    }
    return this.pipeline.previewAccepted(result.settings);
  }

  countries(): CountryDto[] {
    return listCountries().map(({ code, name, timezone, currency, eu }) => ({ code, name, timezone, currency, eu }));
  }
}
