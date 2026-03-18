import { ApiProperty } from '@nestjs/swagger';

export class WordOfMeaningDto {
  @ApiProperty({ example: 'abandon' })
  word: string;
}

export class WordMeaningInListItemDto {
  @ApiProperty({ example: 25 })
  id: number;

  @ApiProperty({ example: 'to leave behind' })
  definition: string;

  @ApiProperty({ example: 'bỏ lại phía sau' })
  vnDefinition: string;

  @ApiProperty({ type: WordOfMeaningDto })
  word: WordOfMeaningDto;
}

export class WordListItermResponseDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 1 })
  listId: number;

  @ApiProperty({ example: 25 })
  wordMeaningId: number;

  @ApiProperty({ example: '2026-03-15T09:00:00.000Z' })
  addedAt: Date;

  @ApiProperty({ type: WordMeaningInListItemDto })
  wordMeaning: WordMeaningInListItemDto;
}

export class DeleteWordListItermResponseDto {
  @ApiProperty({ example: 'Word list item deleted successfully' })
  message: string;
}
