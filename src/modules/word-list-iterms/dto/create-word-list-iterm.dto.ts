import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateWordListItermDto {
	@ApiProperty({ example: 1, description: 'ID của word list' })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	listId: number;

	@ApiProperty({ example: 25, description: 'ID của word meaning cần thêm' })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	wordMeaningId: number;
}
