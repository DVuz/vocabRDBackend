import { ApiProperty } from '@nestjs/swagger';

export class SpeakDto {
  @ApiProperty({ description: 'Văn bản cần chuyển thành audio', example: 'Hello world' })
  text: string;
}
