import { ApiPropertyOptional } from '@nestjs/swagger';
import { JOB_CONTRACT_TYPES, JOB_STATUSES, REMOTE_TYPES } from '@jobagg/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { EmptyToUndefined, ToBoolean } from '../common/transforms';

export class JobsQueryDto {
  @ApiPropertyOptional({ description: 'Ricerca full-text su titolo, azienda e descrizione' })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ enum: REMOTE_TYPES })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(REMOTE_TYPES)
  remote?: (typeof REMOTE_TYPES)[number];

  @ApiPropertyOptional({ enum: JOB_CONTRACT_TYPES })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(JOB_CONTRACT_TYPES)
  contractType?: (typeof JOB_CONTRACT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Solo annunci compatibili con la situazione P.IVA dell’utente' })
  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  vatCompatible?: boolean;

  @ApiPropertyOptional({ description: 'Include gli annunci scartati dai filtri' })
  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  includeRejected?: boolean;

  @ApiPropertyOptional({ enum: ['score', 'date'] })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(['score', 'date'])
  sort?: 'score' | 'date';

  @ApiPropertyOptional({ minimum: 1 })
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class UpdateJobDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;
}
