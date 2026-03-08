import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class UserWordService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all words of a user with optional filters
   */
  /**
   * Thêm 1 meaning vào danh sách từ của user.
   * Nếu đã có rồi thì trả về bản ghi cũ (idempotent).
   */
  async addUserWord(userId: number, meaningId: number) {
    // Kiểm tra meaning có tồn tại không
    const meaning = await this.prisma.wordMeaning.findUnique({
      where: { id: meaningId },
      include: { word: true },
    });

    if (!meaning) {
      throw new NotFoundException(`Không tìm thấy meaning id=${meaningId}`);
    }

    // Upsert: nếu đã lưu rồi thì trả về bản ghi cũ, không báo lỗi
    const existing = await this.prisma.userWord.findFirst({
      where: { userId, wordMeaningId: meaningId },
    });

    if (existing) {
      throw new ConflictException('Bạn đã lưu từ này rồi');
    }

    const userWord = await this.prisma.userWord.create({
      data: {
        userId,
        wordMeaningId: meaningId,
        status: 'new',
      },
    });

    return {
      userWordId: userWord.id,
      wordId: meaning.wordId,
      word: meaning.word.word,
      meaningId: meaning.id,
      definition: meaning.definition,
      vnDefinition: meaning.vnDefinition,
      partOfSpeech: meaning.partOfSpeech,
      addedAt: userWord.addedAt,
    };
  }

  /**
   * Lấy danh sách từ của chính user đang đăng nhập (từ JWT).
   * Trả về pagination metadata đầy đủ.
   */
  async getMyWords(
    userId: number,
    page: number = 1,
    pageSize: number = 20,
    status?: string,
    isFavorite?: boolean
  ) {
    const where: any = { userId };
    if (status) where.status = status;
    if (isFavorite !== undefined) where.isFavorite = isFavorite;

    const skip = (page - 1) * pageSize;

    const [total, userWords] = await this.prisma.$transaction([
      this.prisma.userWord.count({ where }),
      this.prisma.userWord.findMany({
        where,
        skip,
        take: pageSize,
        include: { wordMeaning: { include: { word: true } } },
        orderBy: { addedAt: 'desc' },
      }),
    ]);

    const data = userWords.map(uw => ({
      userWordId: uw.id,
      wordId: uw.wordMeaning.wordId,
      word: uw.wordMeaning.word.word,
      meaningId: uw.wordMeaning.id,
      definition: uw.wordMeaning.definition,
      vnDefinition: uw.wordMeaning.vnDefinition,
      partOfSpeech: uw.wordMeaning.partOfSpeech,
      cefrLevel: uw.wordMeaning.cefrLevel,
      examples: uw.wordMeaning.examples ?? [],
      ipa: { uk: uw.wordMeaning.ukIpa, us: uw.wordMeaning.usIpa },
      audio: { uk: uw.wordMeaning.ukAudioUrl, us: uw.wordMeaning.usAudioUrl },
      status: uw.status,
      isFavorite: uw.isFavorite,
      totalReviews: uw.totalReviews,
      correctCount: uw.correctCount,
      currentStreak: uw.currentStreak,
      easeFactor: uw.easeFactor,
      nextReviewAt: uw.nextReviewAt,
      addedAt: uw.addedAt,
    }));

    return {
      data,
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
   * Xóa 1 UserWord khỏi danh sách học của user.
   * Chỉ cho phép xóa nếu từ chưa được ôn tập lần nào (totalReviews === 0).
   */
  async removeUserWord(userId: number, userWordId: number) {
    const userWord = await this.prisma.userWord.findUnique({
      where: { id: userWordId },
      include: { wordMeaning: { include: { word: true } } },
    });

    if (!userWord) {
      throw new NotFoundException(`Không tìm thấy userWord id=${userWordId}`);
    }

    if (userWord.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xóa từ này');
    }

    if ((userWord.totalReviews ?? 0) > 0) {
      throw new BadRequestException(
        'Không thể xóa từ đã được ôn tập. Chỉ có thể xóa từ chưa ôn tập lần nào.'
      );
    }

    await this.prisma.userWord.delete({ where: { id: userWordId } });

    return {
      message: `Đã xóa "${userWord.wordMeaning.word.word}" khỏi danh sách học`,
      userWordId,
      word: userWord.wordMeaning.word.word,
      meaningId: userWord.wordMeaningId,
    };
  }

  /**
   * Get all words of a user with optional filters (legacy – giữ để GET /users/:userId/words vẫn hoạt động)
   */
  async getUserWords(
    userId: number,
    skip: number = 0,
    take: number = 100,
    status?: string,
    isFavorite?: boolean
  ) {
    const where: any = { userId };
    if (status) where.status = status;
    if (isFavorite !== undefined) where.isFavorite = isFavorite;

    const userWords = await this.prisma.userWord.findMany({
      where,
      skip,
      take,
      include: { wordMeaning: { include: { word: true } } },
      orderBy: { addedAt: 'desc' },
    });

    return userWords.map(uw => ({
      userWordId: uw.id,
      wordId: uw.wordMeaning.wordId,
      word: uw.wordMeaning.word.word,
      meaningId: uw.wordMeaning.id,
      definition: uw.wordMeaning.definition,
      vnDefinition: uw.wordMeaning.vnDefinition,
      partOfSpeech: uw.wordMeaning.partOfSpeech,
      examples: uw.wordMeaning.examples ?? [],
      ipa: { uk: uw.wordMeaning.ukIpa, us: uw.wordMeaning.usIpa },
      audio: { uk: uw.wordMeaning.ukAudioUrl, us: uw.wordMeaning.usAudioUrl },
      status: uw.status,
      isFavorite: uw.isFavorite,
      totalReviews: uw.totalReviews,
      correctCount: uw.correctCount,
      currentStreak: uw.currentStreak,
      easeFactor: uw.easeFactor,
      nextReviewAt: uw.nextReviewAt,
      addedAt: uw.addedAt,
    }));
  }
}
