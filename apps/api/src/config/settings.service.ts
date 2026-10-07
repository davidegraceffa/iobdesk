import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  diffSettings,
  formatZodIssues,
  isOnboardingComplete,
  settingsSchema,
  type FieldError,
  type Settings,
  type SettingsDiffEntry,
} from '@jobagg/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { parse as parseYaml } from 'yaml';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from './env';

export interface SettingsSnapshot {
  settings: Settings;
  version: number;
  updatedAt: Date | null;
}

export interface SettingsChange {
  previous: Settings | null;
  current: Settings;
  version: number;
  /** l'onboarding è stato completato con questo salvataggio */
  onboardingJustCompleted: boolean;
}

export type ValidationResult = { success: true; settings: Settings } | { success: false; errors: FieldError[] };

/**
 * In YAML una chiave senza valore (es. `user:` con le sole righe commentate sotto) vale `null`:
 * la trattiamo come assente, così valgono i default dello schema.
 */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(dropNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
}

/**
 * Impostazioni utente. La fonte di verità è la tabella UserSettings (una riga):
 * `config/search.yaml` serve solo per il seed iniziale e non viene mai riscritto.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: SettingsSnapshot | null = null;
  /** emesso dopo ogni salvataggio riuscito */
  readonly changes$ = new Subject<SettingsChange>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  validate(input: unknown): ValidationResult {
    const parsed = settingsSchema.safeParse(dropNulls(input ?? {}));
    if (parsed.success) return { success: true, settings: parsed.data };
    return { success: false, errors: formatZodIssues(parsed.error) };
  }

  /** Legge il seed YAML. Un file assente o non valido non blocca l'avvio: si parte dai default. */
  readSeed(): Settings {
    const file = join(this.env.configDir, 'search.yaml');
    if (!existsSync(file)) {
      this.logger.warn(`Seed ${file} non trovato: uso le impostazioni di default`);
      return settingsSchema.parse({});
    }
    try {
      const result = this.validate(parseYaml(readFileSync(file, 'utf8')));
      if (result.success) return result.settings;
      this.logger.error(
        `Seed ${file} non valido, uso i default: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      );
    } catch (err) {
      this.logger.error(`Impossibile leggere ${file}: ${(err as Error).message}`);
    }
    return settingsSchema.parse({});
  }

  async snapshot(): Promise<SettingsSnapshot> {
    if (this.cache) return this.cache;
    let row = await this.prisma.userSettings.findUnique({ where: { id: 1 } });
    if (!row) {
      const seed = this.readSeed();
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.userSettings.create({
          data: { id: 1, version: 1, data: seed as unknown as Prisma.InputJsonValue },
        });
        await tx.userSettingsHistory.create({
          data: { version: 1, reason: 'seed', data: seed as unknown as Prisma.InputJsonValue },
        });
        return created;
      });
      this.logger.log('Impostazioni inizializzate dal seed config/search.yaml');
    }
    // il parse applica i default ai campi aggiunti in versioni successive dell'app
    const parsed = settingsSchema.safeParse(row.data);
    const settings = parsed.success ? parsed.data : settingsSchema.parse({});
    if (!parsed.success)
      this.logger.error('Impostazioni salvate non valide: uso i default finché non vengono risalvate');
    this.cache = { settings, version: row.version, updatedAt: row.updatedAt };
    return this.cache;
  }

  async get(): Promise<Settings> {
    return (await this.snapshot()).settings;
  }

  async isOnboarded(): Promise<boolean> {
    return isOnboardingComplete(await this.get());
  }

  /** Salvataggio validato: crea una voce di storico e notifica scheduler e ricalcolo. */
  async save(input: unknown, reason = 'save'): Promise<SettingsSnapshot> {
    const result = this.validate(input);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Impostazioni non valide: nulla è stato salvato',
        errors: result.errors,
      });
    }
    const previous = await this.snapshot();
    const data = result.settings as unknown as Prisma.InputJsonValue;
    const version = previous.version + 1;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userSettings.update({ where: { id: 1 }, data: { data, version } });
      await tx.userSettingsHistory.create({ data: { version, reason, data } });
      return updated;
    });
    this.cache = { settings: result.settings, version: row.version, updatedAt: row.updatedAt };
    this.changes$.next({
      previous: previous.settings,
      current: result.settings,
      version,
      onboardingJustCompleted: !isOnboardingComplete(previous.settings) && isOnboardingComplete(result.settings),
    });
    return this.cache;
  }

  async history(
    limit = 50,
  ): Promise<Array<{ id: string; version: number; savedAt: Date; reason: string; changes: SettingsDiffEntry[] }>> {
    const rows = await this.prisma.userSettingsHistory.findMany({ orderBy: { version: 'desc' }, take: limit + 1 });
    return rows.slice(0, limit).map((row, i) => ({
      id: row.id,
      version: row.version,
      savedAt: row.savedAt,
      reason: row.reason,
      // differenze rispetto alla versione precedente
      changes: rows[i + 1] ? diffSettings(rows[i + 1]!.data, row.data) : [],
    }));
  }

  async restore(historyId: string): Promise<SettingsSnapshot> {
    const entry = await this.prisma.userSettingsHistory.findUnique({ where: { id: historyId } });
    if (!entry) throw new NotFoundException('Versione non trovata nello storico');
    return this.save(entry.data, `restore:v${entry.version}`);
  }

  /** Solo per i test. */
  resetCache(): void {
    this.cache = null;
  }
}
