import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTtsVoiceModelDto {
  @ApiPropertyOptional({ example: 'English Female B' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ example: '21m00Tcm4TlvDq8ikWAM' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  voiceId?: string;

  @ApiPropertyOptional({ example: 'eleven_multilingual_v2' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
