import { PartialType } from '@nestjs/swagger';
import { CreateWordListItermDto } from './create-word-list-iterm.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateWordListItermDto extends PartialType(CreateWordListItermDto) {
	@ApiPropertyOptional({
		example: 30,
		description: 'ID word meaning mới muốn cập nhật vào item',
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	wordMeaningId?: number;
}
