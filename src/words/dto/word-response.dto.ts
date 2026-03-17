import { ApiProperty } from '@nestjs/swagger';

export class WordMeaningResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() partOfSpeech: string;
  @ApiProperty() cefrLevel: string;
  @ApiProperty() definition: string;
  @ApiProperty() vnDefinition: string;
  @ApiProperty({ type: [String] }) examples: string[];
  @ApiProperty({ type: Object }) ipa: { uk: string; us: string };
  @ApiProperty({ type: Object }) audio: { uk: string; us: string };
}

export class WordResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() word: string;
  @ApiProperty({ type: [WordMeaningResponseDto] }) meanings: WordMeaningResponseDto[];
}
