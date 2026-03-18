import { WordResponseDto } from '../dto/word-response.dto';

export interface IWordLookup {
  findByWord(word: string): Promise<WordResponseDto | null>;
}

export const WORD_LOOKUP = 'WORD_LOOKUP';
