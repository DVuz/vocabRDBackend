import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ required: false, description: 'Web: authorization code' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ required: false, description: 'Web: thường là "postmessage"' })
  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  codeVerifier?: string;

  @ApiProperty({ required: false, description: 'App mobile: Google id_token' })
  @IsOptional()
  @IsString()
  idToken?: string;
}