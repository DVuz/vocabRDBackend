import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CrawlerService } from './crawler.service';

@Injectable()
export class WordService {
  private readonly logger = new Logger(WordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: CrawlerService
  ) {}

  /**
   * Get a Word with all its meanings (like Cambridge dictionary)
   */
  async getWordWithMeanings(wordString: string) {
    const result = await this.prisma.word.findFirst({
      where: { word: { equals: wordString, mode: 'insensitive' } },
      include: { wordMeanings: true },
    });

    if (result) {
      return {
        id: result.id,
        word: result.word,
        meanings: result.wordMeanings.map(m => ({
          id: m.id,
          partOfSpeech: m.partOfSpeech,
          cefrLevel: m.cefrLevel,
          definition: m.definition,
          vnDefinition: m.vnDefinition,
          examples: m.examples ?? [],
          ipa: { uk: m.ukIpa, us: m.usIpa },
          audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
        })),
      };
    }

    // Not in DB — try crawling from Cambridge
    this.logger.log(`"${wordString}" not in DB, attempting crawl...`);
    const crawled = await this.crawler.crawlAndSave(wordString);
    if (crawled) {
      return { id: crawled.id, word: crawled.word, meanings: crawled.meanings };
    }

    throw new NotFoundException(`Word '${wordString}' not found`);
  }

  /**
   * Get a single WordMeaning by its id
   */
  async findMeaningById(id: number) {
    const meaning = await this.prisma.wordMeaning.findUnique({
      where: { id },
      include: { word: true },
    });

    if (!meaning) {
      throw new NotFoundException(`WordMeaning with id ${id} not found`);
    }

    return {
      meaningId: meaning.id,
      wordId: meaning.wordId,
      word: meaning.word.word,
      partOfSpeech: meaning.partOfSpeech,
      cefrLevel: meaning.cefrLevel,
      definition: meaning.definition,
      vnDefinition: meaning.vnDefinition,
      examples: meaning.examples ?? [],
      ipa: {
        uk: meaning.ukIpa,
        us: meaning.usIpa,
      },
      audio: {
        uk: meaning.ukAudioUrl,
        us: meaning.usAudioUrl,
      },
      createdAt: meaning.createdAt,
    };
  }
}
