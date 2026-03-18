import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetWordsQueryDto {
  @ApiPropertyOptional({ example: 1 }) page?: number;
  @ApiPropertyOptional({ example: 20 }) pageSize?: number;
  @ApiPropertyOptional({
    enum: ['new', 'learning', 'familiar', 'mastered', 'forgotten'],
  })
  status?: string;
  @ApiPropertyOptional() isFavorite?: boolean;
}
