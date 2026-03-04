import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const MAX_DAILY = 20;

// ── SM-2 helpers ──────────────────────────────────────────────────────────

function nextInterval(currentInterval: number, easeFactor: number, streak: number): number {
  if (streak <= 0) return 1;
  if (streak === 1) return 1;
  if (streak === 2) return 6;
  return Math.round(currentInterval * Number(easeFactor));
}

function updatedEase(ease: number, correct: boolean): number {
  //  SM-2: EF' = EF + 0.1 - (5-q)*(0.08+(5-q)*0.02)  with q=5 (correct) or q=0 (wrong)
  const q = correct ? 5 : 0;
  const newEase = ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  return Math.max(1.3, Math.min(2.5, Math.round(newEase * 100) / 100));
}

function nextStatus(current: string, streak: number, correct: boolean): string {
  if (!correct) return 'forgotten';
  switch (current) {
    case 'new':
      return 'learning';
    case 'forgotten':
      return 'learning';
    case 'learning':
      return streak >= 5 ? 'familiar' : 'learning';
    case 'familiar':
      return streak >= 10 ? 'mastered' : 'familiar';
    default:
      return current;
  }
}

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /review/today
   * Returns up to MAX_DAILY words due today, sorted by priority:
   *   1. forgotten  (most overdue first)
   *   2. learning / familiar  (most overdue first)
   *   3. mastered   (most overdue first)
   *   4. new        (oldest added first)
   */
  async getTodayQueue(userId: number) {
    const now = new Date();

    // Fetch all candidates in one query
    const candidates = await this.prisma.userWord.findMany({
      where: {
        userId,
        OR: [
          { nextReviewAt: null }, // new words never reviewed
          { nextReviewAt: { lte: now } }, // due or overdue
        ],
      },
      include: {
        wordMeaning: { include: { word: true } },
      },
      orderBy: { addedAt: 'asc' },
    });

    // Sort by priority
    const priority = (status: string, nextReviewAt: Date | null): number => {
      if (status === 'forgotten') return 0;
      if (status === 'learning') return 1;
      if (status === 'familiar') return 2;
      if (status === 'mastered') return 3;
      return 4; // new
    };

    candidates.sort((a, b) => {
      const pa = priority(a.status ?? 'new', a.nextReviewAt);
      const pb = priority(b.status ?? 'new', b.nextReviewAt);
      if (pa !== pb) return pa - pb;
      // Within same priority: most overdue (or oldest added) first
      const ta = a.nextReviewAt?.getTime() ?? a.addedAt?.getTime() ?? 0;
      const tb = b.nextReviewAt?.getTime() ?? b.addedAt?.getTime() ?? 0;
      return ta - tb;
    });

    const top = candidates.slice(0, MAX_DAILY);

    return top.map(uw => this.mapRow(uw));
  }

  /**
   * POST /review/:userWordId
   * Submit a single review result and run SM-2 update.
   */
  async submitReview(userId: number, userWordId: number, correct: boolean) {
    const uw = await this.prisma.userWord.findFirst({
      where: { id: userWordId, userId },
    });

    if (!uw) throw new NotFoundException('UserWord không tồn tại');

    const prevStreak = uw.currentStreak ?? 0;
    const prevEase = Number(uw.easeFactor ?? 2.5);
    const prevInterval = uw.intervalDays ?? 1;

    const newStreak = correct ? prevStreak + 1 : 0;
    const newEase = updatedEase(prevEase, correct);
    const newInterval = correct ? nextInterval(prevInterval, newEase, newStreak) : 1;
    const newStatus = nextStatus(uw.status ?? 'new', newStreak, correct);

    const now = new Date();
    const nextReviewAt = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.userWord.update({
      where: { id: userWordId },
      data: {
        status: newStatus as any,
        currentStreak: newStreak,
        maxStreak: Math.max(uw.maxStreak ?? 0, newStreak),
        easeFactor: newEase,
        intervalDays: newInterval,
        nextReviewAt,
        lastReviewedAt: now,
        totalReviews: { increment: 1 },
        ...(correct ? { correctCount: { increment: 1 } } : { incorrectCount: { increment: 1 } }),
        updatedAt: now,
      },
      include: {
        wordMeaning: { include: { word: true } },
      },
    });

    return {
      userWordId: updated.id,
      correct,
      newStatus,
      newStreak,
      newIntervalDays: newInterval,
      newEaseFactor: newEase,
      nextReviewAt,
    };
  }

  /**
   * POST /review/submit-bulk
   * Accept array of { userWordId, correct } and apply SM-2 to each.
   * Also saves a ReviewSession + ReviewSessionItems for history.
   */
  async submitBulk(
    userId: number,
    results: { userWordId: number; correct: boolean }[],
    durationSeconds?: number
  ) {
    // Capture "before" state for each word
    const beforeWords = await this.prisma.userWord.findMany({
      where: { id: { in: results.map(r => r.userWordId) }, userId },
    });
    const beforeMap = new Map(beforeWords.map(w => [w.id, w]));

    const now = new Date();

    // Run SM-2 updates
    const out: Awaited<ReturnType<typeof this.submitReview>>[] = [];
    for (const r of results) {
      const res = await this.submitReview(userId, r.userWordId, r.correct);
      out.push(res);
    }

    const correctCount = out.filter(r => r.correct).length;
    const scorePercent = out.length ? Math.round((correctCount / out.length) * 100) : 0;

    // Persist session + items
    let sessionId: number | undefined;
    try {
      const session = await this.prisma.reviewSession.create({
        data: {
          userId,
          sessionType: 'multiple_choice',
          sourceType: 'daily_queue',
          totalQuestions: out.length,
          correctAnswers: correctCount,
          incorrectAnswers: out.length - correctCount,
          scorePercent,
          durationSeconds: durationSeconds ?? null,
          status: 'completed',
          finishedAt: now,
          reviewSessionItems: {
            create: results.map((r, idx) => {
              const before = beforeMap.get(r.userWordId);
              const after = out[idx];
              return {
                userWordId: r.userWordId,
                questionType: 'word_to_definition',
                isCorrect: r.correct,
                streakBefore: before?.currentStreak ?? 0,
                easeBefore: before ? Number(before.easeFactor ?? 2.5) : 2.5,
                intervalBefore: before?.intervalDays ?? 1,
                streakAfter: after.newStreak,
                easeAfter: after.newEaseFactor,
                intervalAfter: after.newIntervalDays,
              };
            }),
          },
        },
      });
      sessionId = Number(session.id);
    } catch (_err) {
      // session creation failure must not block the SM-2 update response
    }

    return {
      sessionId,
      total: out.length,
      correct: correctCount,
      incorrect: out.length - correctCount,
      scorePercent,
      details: out,
    };
  }

  /**
   * GET /review/sessions
   * Paginated list of past review sessions for a user.
   */
  async getSessions(userId: number, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;
    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.reviewSession.count({ where: { userId } }),
      this.prisma.reviewSession.findMany({
        where: { userId },
        skip,
        take: pageSize,
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    return {
      data: sessions.map(s => ({
        id: Number(s.id),
        sessionType: s.sessionType,
        totalQuestions: s.totalQuestions,
        correctAnswers: s.correctAnswers,
        incorrectAnswers: s.incorrectAnswers,
        scorePercent: s.scorePercent !== null ? Number(s.scorePercent) : null,
        durationSeconds: s.durationSeconds,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page * pageSize < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * GET /review/sessions/:id
   * Full detail of one session including per-word items.
   */
  async getSessionDetail(userId: number, sessionId: bigint) {
    const session = await this.prisma.reviewSession.findFirst({
      where: { id: sessionId, userId },
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

    if (!session) throw new NotFoundException('Session không tồn tại');

    return {
      id: Number(session.id),
      sessionType: session.sessionType,
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
      incorrectAnswers: session.incorrectAnswers,
      scorePercent: session.scorePercent !== null ? Number(session.scorePercent) : null,
      durationSeconds: session.durationSeconds,
      status: session.status,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      items: session.reviewSessionItems.map(item => ({
        id: Number(item.id),
        userWordId: item.userWordId,
        word: item.userWord.wordMeaning.word.word,
        definition: item.userWord.wordMeaning.definition,
        partOfSpeech: item.userWord.wordMeaning.partOfSpeech,
        cefrLevel: item.userWord.wordMeaning.cefrLevel,
        isCorrect: item.isCorrect,
        questionType: item.questionType,
        streakBefore: item.streakBefore,
        streakAfter: item.streakAfter,
        easeAfter: item.easeAfter !== null ? Number(item.easeAfter) : null,
      })),
    };
  }

  // ── map helper ─────────────────────────────────────────────────────────
  private mapRow(uw: any) {
    const m = uw.wordMeaning;
    return {
      userWordId: uw.id,
      wordId: m.wordId,
      word: m.word.word,
      meaningId: m.id,
      partOfSpeech: m.partOfSpeech,
      cefrLevel: m.cefrLevel,
      definition: m.definition,
      vnDefinition: m.vnDefinition,
      examples: (m.examples as string[]) ?? [],
      ipa: { uk: m.ukIpa, us: m.usIpa },
      audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
      status: uw.status,
      currentStreak: uw.currentStreak,
      intervalDays: uw.intervalDays,
      nextReviewAt: uw.nextReviewAt,
    };
  }
}
