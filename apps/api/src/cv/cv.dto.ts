import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CV_LANGUAGES } from '@jobagg/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class UploadBaseCvDto {
  @ApiProperty({ enum: CV_LANGUAGES })
  @IsIn(CV_LANGUAGES)
  language!: (typeof CV_LANGUAGES)[number];
}

export class UpdateStructureDto {
  @ApiProperty({ description: 'id paragrafo → tipo di sezione che inizia lì, oppure "not_heading"' })
  @IsObject()
  overrides!: Record<string, string>;
}

export class GenerateCvDto {
  @ApiProperty({ enum: CV_LANGUAGES })
  @IsIn(CV_LANGUAGES)
  language!: (typeof CV_LANGUAGES)[number];

  @ApiPropertyOptional({ description: 'Istruzioni aggiuntive, es. "metti in evidenza l’esperienza con NestJS"' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Consenso esplicito all’invio del CV a un provider LLM esterno' })
  @IsOptional()
  @IsBoolean()
  consentExternal?: boolean;
}

export class GenerateManualCvDto extends GenerateCvDto {
  @ApiProperty({ description: 'Ruolo, come scritto nell’annuncio' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company!: string;

  @ApiProperty({ description: 'Testo dell’annuncio incollato a mano' })
  @IsString()
  @MinLength(150)
  @MaxLength(30000)
  description!: string;
}

export class RegenerateCvDto {
  @IsOptional()
  @IsIn(CV_LANGUAGES)
  language?: (typeof CV_LANGUAGES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  consentExternal?: boolean;
}

export class EditChangeDto {
  @ApiProperty()
  @IsString()
  editId!: string;

  @ApiPropertyOptional({ enum: ['accepted', 'rejected'] })
  @IsOptional()
  @IsIn(['accepted', 'rejected'])
  status?: 'accepted' | 'rejected';

  @ApiPropertyOptional({ description: 'Testo ritoccato a mano; null per tornare al testo proposto' })
  @IsOptional()
  @ValidateIf((o: EditChangeDto) => o.manualText !== null)
  @IsString()
  @MaxLength(2000)
  manualText?: string | null;
}

export class PatchEditsDto {
  @ApiProperty({ type: [EditChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EditChangeDto)
  changes!: EditChangeDto[];
}

export class UpdateCoverLetterDto {
  @ApiPropertyOptional({ description: 'Oggetto della lettera' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'Testo dal saluto alla firma, paragrafi separati da una riga vuota' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;
}

export class GenerateCvEmailDto {
  @ApiPropertyOptional({ description: 'Istruzioni aggiuntive, es. "tono informale"' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class UpdateCvEmailDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'Testo dal saluto alla firma, paragrafi separati da una riga vuota' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;
}

export class RunCvReviewDto {
  @ApiPropertyOptional({ enum: CV_LANGUAGES, description: 'Vuoto = tutti i CV base' })
  @IsOptional()
  @IsIn(CV_LANGUAGES)
  language?: (typeof CV_LANGUAGES)[number];
}

export class CvReviewScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Giorni tra un controllo automatico e il successivo' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  intervalDays?: number;
}

export class ExtraSkillsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  items!: string[];
}

export class SuggestionStatusDto {
  @ApiProperty({ enum: ['open', 'applied', 'done', 'dismissed'] })
  @IsIn(['open', 'applied', 'done', 'dismissed'])
  status!: 'open' | 'applied' | 'done' | 'dismissed';
}

export class CvAtsDto {
  @ApiProperty({ enum: CV_LANGUAGES })
  @IsIn(CV_LANGUAGES)
  language!: (typeof CV_LANGUAGES)[number];
}
