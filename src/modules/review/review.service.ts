import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserWordStatus } from '@prisma/client';
import { ReviewQueryDto } from './dto/review-query.dto';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_DAILY,
} from './helpers/review.constants';
import { sortByReviewPriority } from './helpers/review-priority.helper';
import { buildPagination } from './helpers/pagination.helper';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodayDueWords(userId: number, query: ReviewQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const now = new Date();

    const where = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
    };

    const [total, words] = await this.prisma.$transaction([
      this.prisma.userWord.count({ where }),
      this.prisma.userWord.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { wordMeaning: { include: { word: true } } },
        orderBy: [{ nextReviewAt: 'asc' }, { addedAt: 'asc' }],
      }),
    ]);

    return {
      data: words.map((word) => this.mapUserWordRow(word)),
      pagination: buildPagination(total, page, pageSize),
    };
  }

  async getPracticeQueue(userId: number, query: ReviewQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const now = new Date();

    const candidates = await this.prisma.userWord.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
      },
      include: { wordMeaning: { include: { word: true } } },
      orderBy: { addedAt: 'asc' },
    });

    const prioritized = sortByReviewPriority(candidates).slice(0, MAX_DAILY);
    const total = prioritized.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      data: prioritized.slice(start, end).map((word) => this.mapUserWordRow(word)),
      pagination: buildPagination(total, page, pageSize),
    };
  }

  private mapUserWordRow(userWord: any) {
    const meaning = userWord.wordMeaning;

    return {
      userWordId: userWord.id,
      wordId: meaning.wordId,
      word: meaning.word.word,
      meaningId: meaning.id,
      partOfSpeech: meaning.partOfSpeech,
      cefrLevel: meaning.cefrLevel,
      definition: meaning.definition,
      vnDefinition: meaning.vnDefinition,
      examples: (meaning.examples as string[]) ?? [],
      ipa: { uk: meaning.ukIpa, us: meaning.usIpa },
      audio: {
        tts: meaning.ttsAudioUrl,
        uk: meaning.ukAudioUrl,
        us: meaning.usAudioUrl,
      },
      status: userWord.status ?? UserWordStatus.new,
      currentStreak: userWord.currentStreak,
      intervalDays: userWord.intervalDays,
      nextReviewAt: userWord.nextReviewAt,
      addedAt: userWord.addedAt,
    };
  }
}
