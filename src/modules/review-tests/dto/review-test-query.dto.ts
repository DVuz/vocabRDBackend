import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserWordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from 'src/modules/review/helpers/review.constants';

export class ReviewTestQueryDto {
  @ApiPropertyOptional({ example: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ example: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ enum: UserWordStatus })
  @IsOptional()
  @IsEnum(UserWordStatus)
  status?: UserWordStatus;
}
