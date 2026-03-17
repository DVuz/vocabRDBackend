import { ApiProperty } from '@nestjs/swagger';

export class SubmitReviewDto {
  @ApiProperty({ description: 'Trả lời đúng hay sai', example: true })
  correct: boolean;
}
