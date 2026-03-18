import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWordListDto {
  @ApiProperty({ example: 1 })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1 })
  @IsOptional()
  description?: string;

  @ApiProperty({ example: false })
  @IsOptional()
  isPublic: false;
}
