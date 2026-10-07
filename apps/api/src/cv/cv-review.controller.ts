import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CvAtsReport, CvReviewApplyResult, CvReviewDto, CvReviewOverview } from '@jobagg/shared';
import { CvReviewService } from './cv-review.service';
import { CvAtsDto, CvReviewScheduleDto, ExtraSkillsDto, RunCvReviewDto, SuggestionStatusDto } from './cv.dto';

@ApiTags('cv-review')
@Controller('cv/review')
export class CvReviewController {
  constructor(private readonly reviews: CvReviewService) {}

  @Get()
  @ApiOperation({ summary: 'Ultimo controllo per ogni CV base, proposte, cosa chiede il mercato, aggiunte dichiarate' })
  overview(): Promise<CvReviewOverview> {
    return this.reviews.overview();
  }

  @Post('run')
  @HttpCode(202)
  @ApiOperation({ summary: 'Avvia subito il controllo di un CV base (o di tutti)' })
  run(@Body() dto: RunCvReviewDto): Promise<CvReviewDto[]> {
    return this.reviews.request(dto.language);
  }

  @Post('ats')
  @HttpCode(202)
  @ApiOperation({ summary: 'Avvia la valutazione di compatibilità ATS del CV base attivo di una lingua' })
  ats(@Body() dto: CvAtsDto): Promise<CvAtsReport> {
    return this.reviews.requestAts(dto.language);
  }

  @Put('schedule')
  @ApiOperation({ summary: 'Attiva o disattiva il controllo periodico e ne cambia la frequenza' })
  schedule(@Body() dto: CvReviewScheduleDto): Promise<CvReviewOverview> {
    return this.reviews.updateSchedule(dto);
  }

  @Put('extra-skills')
  @ApiOperation({ summary: 'Sostituisce l’elenco delle cose da aggiungere nei CV (competenze ed esperienze reali)' })
  extraSkills(@Body() dto: ExtraSkillsDto): Promise<CvReviewOverview> {
    return this.reviews.setExtraSkills(dto.items);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: 'Applica tutte le proposte aperte applicabili: genera una nuova versione del CV base' })
  applyAll(@Param('id') id: string): Promise<CvReviewApplyResult> {
    return this.reviews.applyAll(id);
  }

  @Patch(':id/suggestions/:suggestionId')
  @ApiOperation({
    summary: 'Applica una proposta al documento (nuova versione del CV base), oppure la segna fatta, ignorata o aperta',
  })
  suggestion(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: SuggestionStatusDto,
  ): Promise<CvReviewApplyResult> {
    return this.reviews.setSuggestionStatus(id, suggestionId, dto.status);
  }
}
