import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWordListDto {
  @ApiPropertyOptional({ example: 'IELTS Vocabulary Updated' })
  name?: string;

  @ApiPropertyOptional()
  description?: string;
}
