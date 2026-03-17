import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Single Responsibility: chỉ thực hiện DB lookup cho word
 */
@Injectable()
export class WordLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findByExactWord(word: string) {
    return this.prisma.word.findFirst({
      where: { word: { equals: word, mode: 'insensitive' } },
      include: { wordMeanings: true },
    });
  }

  async findByAlias(alias: string) {
    return this.prisma.wordAlias.findUnique({ where: { alias } });
  }

  async findMeaningById(id: number) {
    return this.prisma.wordMeaning.findUnique({
      where: { id },
      include: { word: true },
    });
  }
}
