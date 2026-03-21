import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WordResponseDto } from './dto/word-response.dto';
import { WordLookupService } from './services/word-lookup.service';

@Injectable()
export class WordService {
  private readonly logger = new Logger(WordService.name);

  constructor(private readonly wordLookupService: WordLookupService) {}

  async getWordWithMeanings(
    word: string,
    includeMeta = false,
  ): Promise<WordResponseDto> {
    const normalizedWord = word.trim().toLowerCase();
    const wordRecord =
      await this.wordLookupService.findWordWithMeanings(normalizedWord);
    if (!wordRecord) {
      this.logger.warn(`Word not found: ${normalizedWord}`);
      throw new NotFoundException(`Word not found: ${normalizedWord}`);
    }

    return this.toWordResponse(wordRecord, includeMeta);
  }

  private toWordResponse(
    wordRecord: {
      id: number;
      word: string;
      createdAt: Date | null;
      updatedAt: Date | null;
      wordMeanings: Array<{
        id: number;
        partOfSpeech: string | null;
        cefrLevel: string | null;
        definition: string;
        vnDefinition: string;
        examples: unknown;
        ukIpa: string | null;
        usIpa: string | null;
        ttsAudioUrl: string | null;
        ukAudioUrl: string | null;
        usAudioUrl: string | null;
        createdAt: Date | null;
      }>;
    },
    includeMeta: boolean,
  ): WordResponseDto {
    return {
      id: wordRecord.id,
      word: wordRecord.word,
      ...(includeMeta
        ? {
            meta: {
              createdAt: wordRecord.createdAt,
              updatedAt: wordRecord.updatedAt,
            },
          }
        : {}),
      meanings: wordRecord.wordMeanings.map((meaning) => ({
        id: meaning.id,
        partOfSpeech: meaning.partOfSpeech,
        cefrLevel: meaning.cefrLevel,
        definition: meaning.definition,
        vnDefinition: meaning.vnDefinition,
        examples: this.toExamplesArray(meaning.examples),
        ipa: {
          uk: meaning.ukIpa,
          us: meaning.usIpa,
        },
        audio: {
          tts: meaning.ttsAudioUrl,
          uk: meaning.ukAudioUrl,
          us: meaning.usAudioUrl,
        },
        ...(includeMeta
          ? {
              meta: {
                createdAt: meaning.createdAt,
              },
            }
          : {}),
      })),
    };
  }

  private toExamplesArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }
}
