import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CambridgeCrawlerService } from './crawler.service';

@Injectable()
export class WordService {
  private readonly logger = new Logger(WordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: CambridgeCrawlerService,
  ) {}

  /**
   * Get a Word with all its meanings (like Cambridge dictionary)
   */
  async getWordWithMeanings(wordString: string) {
    const w = wordString.toLowerCase().trim();

    // 1. Alias table — covers irregular forms cached from prior Cambridge resolves
    //    (went→go, was→be, sizes→size, ...)
    const wordRecord =
      (await this.findByAlias(w)) ??
      (await this.findInDb(w)) ??
      (await this.crawlThenFind(w));

    if (!wordRecord) {
      throw new NotFoundException(`Word '${wordString}' not found`);
    }

    return {
      id: wordRecord.id,
      word: wordRecord.word,
      meanings: wordRecord.wordMeanings.map((m) => ({
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

  // ── Step 1: alias lookup ───────────────────────────────────────────────────
  private async findByAlias(w: string) {
    const alias = await this.prisma.wordAlias.findUnique({ where: { alias: w } });
    if (!alias) return null;

    this.logger.log(`"${w}" resolved via alias table → "${alias.canonicalWord}"`);
    return this.findInDb(alias.canonicalWord);
  }

  // ── Step 2: direct DB lookup ───────────────────────────────────────────────
  private async findInDb(w: string) {
    const result = await this.prisma.word.findFirst({
      where: { word: { equals: w, mode: 'insensitive' } },
      include: { wordMeanings: true },
    });

    if (!result || result.wordMeanings.length === 0) return null;

    return result;
  }

  // ── Step 3: crawl Cambridge → save → query DB by canonicalWord ────────────
  // Cambridge tự resolve canonical form (went→go, sizes→size, v.v.),
  // crawler tự lưu alias, ta chỉ query lại DB bằng canonicalWord trả về.
  private async crawlThenFind(w: string) {
    this.logger.log(`"${w}" not in DB — crawling Cambridge...`);

    const crawled = await this.crawler.crawlAndSave(w);
    if (!crawled) return null;

    return this.findInDb(crawled.canonicalWord);
  }
}