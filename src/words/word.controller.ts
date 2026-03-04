import { Controller, Get, Param } from '@nestjs/common';
import { WordService } from './word.service';

@Controller()
export class WordController {
  constructor(private readonly wordService: WordService) {}

  // get one word with all its meanings by word string (like Cambridge dictionary)
  @Get('dict/:word')
  async getDictWord(@Param('word') word: string) {
    return this.wordService.getWordWithMeanings(word);
  }

  // get one words with one meaning by wordMeaning id
  @Get('meanings/:id')
  async getMeaningById(@Param('id') id: string) {
    return this.wordService.findMeaningById(parseInt(id));
  }
}
