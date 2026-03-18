import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  redirect_uri: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  codeVerifier: string;
}
