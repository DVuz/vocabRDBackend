import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTtsConfigDto {
  @ApiPropertyOptional({ example: 'My ElevenLabs Key #2' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'sk_********************************' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
