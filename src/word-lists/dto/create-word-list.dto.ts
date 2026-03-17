import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWordListDto {
  @ApiProperty({ example: 'IELTS Vocabulary' })
  name: string;

  @ApiPropertyOptional({ example: 'Từ vựng cho kỳ thi IELTS' })
  description?: string;
}
