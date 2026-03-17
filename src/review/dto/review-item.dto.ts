import { ApiProperty } from '@nestjs/swagger';

export class ReviewItemDto {
  @ApiProperty() userWordId: number;
  @ApiProperty() wordId: number;
  @ApiProperty() word: string;
  @ApiProperty() meaningId: number;
  @ApiProperty() partOfSpeech: string;
  @ApiProperty() definition: string;
  @ApiProperty() vnDefinition: string;
  @ApiProperty({ type: [String] }) examples: string[];
  @ApiProperty() status: string;
  @ApiProperty() streak: number;
  @ApiProperty({ nullable: true }) nextReviewAt: Date | null;
}
