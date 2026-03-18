import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateWordListDto {
  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  wordListId: number;

  @ApiProperty({ example: 1 })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 1 })
  @IsOptional()
  description?: string;

  @ApiProperty({ example: false })
  @IsOptional()
  isPublic?: boolean;
}
