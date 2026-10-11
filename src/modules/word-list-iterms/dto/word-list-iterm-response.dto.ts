import { ApiProperty } from '@nestjs/swagger';

export class WordIpaDto {
  @ApiProperty({ example: 'əˈbændən', nullable: true })
  uk: string | null;

  @ApiProperty({ example: 'əˈbændən', nullable: true })
  us: string | null;
}

export class WordAudioDto {
  @ApiProperty({
    example: 'https://res.cloudinary.com/example/audio/abandon.mp3',
    nullable: true,
  })
  tts: string | null;

  @ApiProperty({
    example: 'https://example.com/audio/abandon-uk.mp3',
    nullable: true,
  })
  uk: string | null;

  @ApiProperty({
    example: 'https://example.com/audio/abandon-us.mp3',
    nullable: true,
  })
  us: string | null;
}

export class WordDto {
  @ApiProperty({ example: 'abandon' })
  word: string;

  @ApiProperty({ type: WordIpaDto })
  ipa: WordIpaDto;

  @ApiProperty({ type: WordAudioDto })
  audio: WordAudioDto;
}

export class WordMeaningInListItemDto {
  @ApiProperty({ example: 25 })
  id: number;

  @ApiProperty({ example: 'to leave behind' })
  definition: string;

  @ApiProperty({ example: 'bỏ lại phía sau' })
  vnDefinition: string;

  @ApiProperty({ example: 'noun', nullable: true })
  partOfSpeech: string | null;

  @ApiProperty({ type: WordDto })
  word: WordDto;
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
