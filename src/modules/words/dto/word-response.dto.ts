import { ApiProperty } from '@nestjs/swagger';

export class EntityMetaDto {
  @ApiProperty({ nullable: true }) createdAt: Date | null;
  @ApiProperty({ nullable: true }) updatedAt?: Date | null;
}

export class WordMeaningResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ nullable: true }) partOfSpeech: string | null;
  @ApiProperty({ nullable: true }) cefrLevel: string | null;
  @ApiProperty() definition: string;
  @ApiProperty() vnDefinition: string;
  @ApiProperty({ type: [String] }) examples: string[];
  @ApiProperty({ type: Object }) ipa: { uk: string | null; us: string | null };
  @ApiProperty({ type: Object }) audio: {
    uk: string | null;
    us: string | null;
  };
  @ApiProperty({ type: EntityMetaDto, required: false }) meta?: EntityMetaDto;
}

export class WordResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() word: string;
  @ApiProperty({ type: [WordMeaningResponseDto] })
  meanings: WordMeaningResponseDto[];
  @ApiProperty({ type: EntityMetaDto, required: false }) meta?: EntityMetaDto;
}
