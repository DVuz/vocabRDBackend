import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddUserWordDto {
  @ApiProperty({ description: 'ID của WordMeaning muốn lưu', example: 19518 })
  @Type(() => Number)
  @IsInt({ message: 'meaningId phải là số nguyên' })
  @Min(1, { message: 'meaningId phải lớn hơn 0' })
  meaningId: number;
}
