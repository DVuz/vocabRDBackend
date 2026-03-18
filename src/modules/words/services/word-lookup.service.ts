import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CambridgeCrawlerService } from './cambridge-crawler.service';

/**
 * Service for looking up words and their meanings from the database.
 * Searches in the word table first; if not found, searches in the word alias table.
 */
@Injectable()
export class WordLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cambridgeCrawlerService: CambridgeCrawlerService,
  ) {}

  async findWordWithMeanings(word: string) {
    const wordRecord = await this.prisma.word.findUnique({
      where: { word },
      include: { wordMeanings: true },
    });

    if (wordRecord) return wordRecord;

    //if not found in word table, look in alias table
    const aliasRecord = await this.prisma.wordAlias.findUnique({
      where: { alias: word },
    });

    if (aliasRecord) {
      return this.prisma.word.findUnique({
        where: { word: aliasRecord.canonicalWord },
        include: { wordMeanings: true },
      });
    }

    await this.cambridgeCrawlerService.crawlAndSave(word);

    const crawledWordRecord = await this.prisma.word.findUnique({
      where: { word },
      include: { wordMeanings: true },
    });
    if (crawledWordRecord) return crawledWordRecord;

    const crawledAliasRecord = await this.prisma.wordAlias.findUnique({
      where: { alias: word },
    });
    if (!crawledAliasRecord) return null;

    return this.prisma.word.findUnique({
      where: { word: crawledAliasRecord.canonicalWord },
      include: { wordMeanings: true },
    });
  }
}
