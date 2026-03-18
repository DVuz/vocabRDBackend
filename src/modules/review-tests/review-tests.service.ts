import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionType, SourceType, UserWordStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_DAILY,
} from 'src/modules/review/helpers/review.constants';
import { buildPagination } from 'src/modules/review/helpers/pagination.helper';
import { sortByReviewPriority } from 'src/modules/review/helpers/review-priority.helper';
import {
  nextInterval,
  nextStatus,
  updatedEase,
} from 'src/modules/review/helpers/sm2.helper';
import { ReviewTestQueryDto } from './dto/review-test-query.dto';
import { SessionsQueryDto } from './dto/sessions-query.dto';
import { SubmitReviewSessionDto } from './dto/submit-review-session.dto';

@Injectable()
export class ReviewTestsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTestQueue(userId: number, query: ReviewTestQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const now = new Date();

    const candidates = await this.prisma.userWord.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : { status: { not: UserWordStatus.new } }),
        nextReviewAt: { lte: now },
      },
      include: { wordMeaning: { include: { word: true } } },
      orderBy: { addedAt: 'asc' },
    });

    const prioritized = sortByReviewPriority(candidates).slice(0, MAX_DAILY);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      data: prioritized.slice(start, end).map((word) => this.mapUserWordRow(word)),
      pagination: buildPagination(prioritized.length, page, pageSize),
    };
  }

  async submitSession(userId: number, payload: SubmitReviewSessionDto) {
    const { results, durationSeconds } = payload;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const userWordIds = [...new Set(results.map((result) => result.userWordId))];
      const beforeWords = await tx.userWord.findMany({
        where: { userId, id: { in: userWordIds } },
      });

      if (beforeWords.length !== userWordIds.length) {
        throw new NotFoundException('Một hoặc nhiều userWord không tồn tại');
      }

      const beforeMap = new Map(beforeWords.map((word) => [word.id, word]));

      const details: {
        userWordId: number;
        correct: boolean;
        newStatus: UserWordStatus;
        newStreak: number;
        newIntervalDays: number;
        newEaseFactor: number;
        nextReviewAt: Date;
      }[] = [];

      for (const item of results) {
        const existing = beforeMap.get(item.userWordId);
        if (!existing) {
          throw new NotFoundException(`UserWord ${item.userWordId} không tồn tại`);
        }

        const previousStreak = existing.currentStreak ?? 0;
        const previousEase = Number(existing.easeFactor ?? 2.5);
        const previousInterval = existing.intervalDays ?? 1;

        const newStreak = item.correct ? previousStreak + 1 : 0;
        const newEase = updatedEase(previousEase, item.correct);
        const newInterval = item.correct
          ? nextInterval(previousInterval, newEase, newStreak)
          : 1;
        const newStatus = nextStatus(
          existing.status ?? UserWordStatus.new,
          newStreak,
          item.correct,
        );
        const nextReviewAt = new Date(
          now.getTime() + newInterval * 24 * 60 * 60 * 1000,
        );

        await tx.userWord.update({
          where: { id: existing.id },
          data: {
            status: newStatus,
            currentStreak: newStreak,
            maxStreak: Math.max(existing.maxStreak ?? 0, newStreak),
            easeFactor: newEase,
            intervalDays: newInterval,
            nextReviewAt,
            lastReviewedAt: now,
            totalReviews: { increment: 1 },
            ...(item.correct
              ? { correctCount: { increment: 1 } }
              : { incorrectCount: { increment: 1 } }),
          },
        });

        details.push({
          userWordId: existing.id,
          correct: item.correct,
          newStatus,
          newStreak,
          newIntervalDays: newInterval,
          newEaseFactor: newEase,
          nextReviewAt,
        });
      }

      const correctCount = details.filter((item) => item.correct).length;
      const scorePercent = details.length
        ? Number(((correctCount / details.length) * 100).toFixed(2))
        : 0;

      const detailMap = new Map(details.map((item) => [item.userWordId, item]));

      const session = await tx.reviewSession.create({
        data: {
          userId,
          sessionType: SessionType.multiple_choice,
          sourceType: SourceType.daily_queue,
          totalQuestions: details.length,
          correctAnswers: correctCount,
          incorrectAnswers: details.length - correctCount,
          scorePercent,
          durationSeconds: durationSeconds ?? null,
          status: 'completed',
          finishedAt: now,
          reviewSessionItems: {
            create: results.map((item) => {
              const before = beforeMap.get(item.userWordId);
              const after = detailMap.get(item.userWordId);

              if (!before || !after) {
                throw new BadRequestException('Dữ liệu session không hợp lệ');
              }

              return {
                userWordId: item.userWordId,
                questionType: 'word_to_definition',
                isCorrect: item.correct,
                streakBefore: before.currentStreak ?? 0,
                easeBefore: Number(before.easeFactor ?? 2.5),
                intervalBefore: before.intervalDays ?? 1,
                streakAfter: after.newStreak,
                easeAfter: after.newEaseFactor,
                intervalAfter: after.newIntervalDays,
                answeredAt: now,
              };
            }),
          },
        },
      });

      return {
        sessionId: Number(session.id),
        total: details.length,
        correct: correctCount,
        incorrect: details.length - correctCount,
        scorePercent,
        details,
      };
    });
  }

  async getSessions(userId: number, query: SessionsQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where = {
      userId,
      sessionType: SessionType.multiple_choice,
    };

    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.reviewSession.count({ where }),
      this.prisma.reviewSession.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return {
      data: sessions.map((session) => ({
        id: Number(session.id),
        sessionType: session.sessionType,
        sourceType: session.sourceType,
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        incorrectAnswers: session.incorrectAnswers,
        scorePercent:
          session.scorePercent !== null ? Number(session.scorePercent) : null,
        durationSeconds: session.durationSeconds,
        status: session.status,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
      })),
      pagination: buildPagination(total, page, pageSize),
    };
  }

  async getSessionDetail(userId: number, sessionId: bigint) {
    const session = await this.prisma.reviewSession.findFirst({
      where: {
        id: sessionId,
        userId,
        sessionType: SessionType.multiple_choice,
      },
      include: {
        reviewSessionItems: {
          include: {
            userWord: {
              include: {
                wordMeaning: { include: { word: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session không tồn tại');
    }

    return {
      id: Number(session.id),
      sessionType: session.sessionType,
      sourceType: session.sourceType,
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
      incorrectAnswers: session.incorrectAnswers,
      scorePercent:
        session.scorePercent !== null ? Number(session.scorePercent) : null,
      durationSeconds: session.durationSeconds,
      status: session.status,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      items: session.reviewSessionItems.map((item) => ({
        id: Number(item.id),
        userWordId: item.userWordId,
        word: item.userWord.wordMeaning.word.word,
        definition: item.userWord.wordMeaning.definition,
        vnDefinition: item.userWord.wordMeaning.vnDefinition,
        partOfSpeech: item.userWord.wordMeaning.partOfSpeech,
        cefrLevel: item.userWord.wordMeaning.cefrLevel,
        isCorrect: item.isCorrect,
        questionType: item.questionType,
        streakBefore: item.streakBefore,
        streakAfter: item.streakAfter,
        easeBefore: item.easeBefore !== null ? Number(item.easeBefore) : null,
        easeAfter: item.easeAfter !== null ? Number(item.easeAfter) : null,
        intervalBefore: item.intervalBefore,
        intervalAfter: item.intervalAfter,
      })),
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
      audio: { uk: meaning.ukAudioUrl, us: meaning.usAudioUrl },
      status: userWord.status ?? UserWordStatus.new,
      currentStreak: userWord.currentStreak,
      intervalDays: userWord.intervalDays,
      nextReviewAt: userWord.nextReviewAt,
      addedAt: userWord.addedAt,
    };
  }
}
