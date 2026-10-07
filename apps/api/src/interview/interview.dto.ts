import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { INTERVIEW_LANGUAGES } from './prompts';

const LANGUAGES = Object.keys(INTERVIEW_LANGUAGES);
const LANGUAGES_OR_AUTO = [...LANGUAGES, 'auto'];

export class CreateInterviewDto {
  @ApiProperty({
    enum: LANGUAGES_OR_AUTO,
    description: 'Lingua del colloquio (di solito quella dell’annuncio); auto = rilevata dalla descrizione',
  })
  @IsIn(LANGUAGES_OR_AUTO)
  language!: string;

  @ApiProperty({ minimum: 4, maximum: 12, default: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(12)
  questionCount!: number;

  @ApiPropertyOptional({ enum: ['live', 'turns'], description: 'live = conversazione a voce con contro-domande' })
  @IsOptional()
  @IsIn(['live', 'turns'])
  mode?: 'live' | 'turns';

  @ApiPropertyOptional({ description: 'Consenso all’invio dei dati a un provider esterno' })
  @IsOptional()
  @IsBoolean()
  consentExternal?: boolean;

  @ApiPropertyOptional({ description: 'Descrizione dell’annuncio incollata, quando manca' })
  @IsOptional()
  @IsString()
  @MaxLength(40_000)
  description?: string;
}

export class AgainDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  consentExternal?: boolean;
}

export class AnswerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  transcript!: string;

  @ApiProperty({ enum: ['audio', 'text'] })
  @IsIn(['audio', 'text'])
  inputMode!: 'audio' | 'text';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  durationSec?: number;
}

export class LiveTurnDto {
  @ApiProperty({ description: 'Ciò che ha detto il candidato (trascritto o scritto)' })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  durationSec?: number;
}

export class SpeakDto {
  @ApiProperty({ description: 'Testo da pronunciare (una battuta dell’intervistatore o una sua frase)' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ enum: LANGUAGES })
  @IsIn(LANGUAGES)
  language!: string;
}

export class TranscribeDto {
  @ApiProperty({ enum: LANGUAGES })
  @IsIn(LANGUAGES)
  language!: string;

  @ApiPropertyOptional({
    description: 'Colloquio a cui appartiene la risposta: migliora la trascrizione dei termini tecnici',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}
