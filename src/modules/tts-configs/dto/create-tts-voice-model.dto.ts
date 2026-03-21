import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTtsVoiceModelDto {
  @ApiProperty({ example: 'English Female A' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({ example: 'pNInz6obpgDQGcFmaJgB' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  voiceId: string;

  @ApiProperty({ example: 'eleven_multilingual_v2' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  modelId: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
