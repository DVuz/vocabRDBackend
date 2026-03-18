import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class RemoveUserWordDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userWordId: number;
}
