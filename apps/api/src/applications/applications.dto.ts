import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { APPLICATION_CHANNELS, APPLICATION_STATUSES } from '@jobagg/shared';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EmptyToUndefined } from '../common/transforms';

export class ApplyDto {
  @ApiPropertyOptional({ description: 'Data della candidatura (default: adesso)' })
  @IsOptional()
  @IsDateString()
  appliedAt?: string;

  @ApiPropertyOptional({
    enum: APPLICATION_CHANNELS,
    description: 'Default: dedotto dal metodo di candidatura dell’annuncio',
  })
  @IsOptional()
  @IsIn(APPLICATION_CHANNELS)
  channel?: (typeof APPLICATION_CHANNELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'CV generato usato per questa candidatura' })
  @IsOptional()
  @IsString()
  generatedCvId?: string;
}

export class CreateManualApplicationDto extends ApplyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  company!: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  salaryRawText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ description: 'Quale CV è stato inviato (testo libero)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cvSent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cvLanguage?: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  currentStatus?: (typeof APPLICATION_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Nota da registrare nella timeline insieme al cambio di stato o come aggiornamento',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  eventNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @ValidateIf((o: UpdateApplicationDto) => !!o.contactEmail)
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsDateString()
  appliedAt?: string;

  @IsOptional()
  @ValidateIf((o: UpdateApplicationDto) => o.generatedCvId !== null)
  @IsString()
  generatedCvId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cvSent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cvLanguage?: string;

  @ApiPropertyOptional({
    description: 'RAL / retribuzione come testo libero (es. "45.000 € lordi"); vuoto per toglierla',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  salaryRawText?: string;
}

export class ImportApplicationsDto {
  @ApiProperty({ description: 'Contenuto del file CSV (es. foglio di tracciamento esportato da Google Sheets)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1_500_000)
  content!: string;
}

export class ApplicationsQueryDto {
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: (typeof APPLICATION_STATUSES)[number];

  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  from?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  to?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @EmptyToUndefined()
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
