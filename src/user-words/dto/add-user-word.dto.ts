import { ApiProperty } from '@nestjs/swagger';

export class AddUserWordDto {
  @ApiProperty({ description: 'ID của WordMeaning muốn lưu', example: 1 })
  meaningId: number;
}
