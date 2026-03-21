import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SharedTtsAudioService } from './services/shared-tts-audio.service';

@Injectable()
export class UserWordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sharedTtsAudioService: SharedTtsAudioService,
  ) {}

  /**
   * Save a word meaning to the user's list. If the word meaning is already saved, return the existing record.
   * @param userId The ID of the user (extracted from JWT)
   * @param meaningId The ID of the word meaning to save
   * @returns The saved user word record
   */
  async addUserWord(userId: number, meaningId: number) {
    //check meaningId exist in wordMeaning table
    const meaning = await this.prisma.wordMeaning.findUnique({
      where: { id: meaningId },
      include: { word: true },
    });
    if (!meaning) {
      throw new NotFoundException(
        'Not found word meaning with id ' + meaningId,
      );
    }

    //upsert: if user already saved this meaning, return existed record, otherwise create new one
    const existed = await this.prisma.userWord.findFirst({
      where: {
        userId,
        wordMeaningId: meaningId,
      },
    });
    if (existed) {
      throw new ConflictException('User already saved this word meaning');
    }

    const userWord = await this.prisma.userWord.create({
      data: {
        userId,
        wordMeaningId: meaningId,
        status: 'new',
      },
    });

    const ttsAudioUrl = meaning.ttsAudioUrl
      ? meaning.ttsAudioUrl
      : await this.sharedTtsAudioService.ensureMeaningTtsAudio({
          userId,
          meaningId: meaning.id,
          definition: meaning.definition,
          ttsAudioUrl: meaning.ttsAudioUrl,
        });

    return {
      userWordId: userWord.id,
      wordId: meaning.wordId,
      word: meaning.word.word,
      meaningId: meaning.id,
      definition: meaning.definition,
      vnDefinition: meaning.vnDefinition,
      partOfSpeech: meaning.partOfSpeech,
      audioUrl: ttsAudioUrl,
      addedAt: userWord.addedAt,
    };
  }
  /**
   * Get the list of words saved by the user. The userId is extracted from JWT.
   * @param userId The ID of the user (extracted from JWT)
   * @returns The list of user words with their meanings
   * @param page
   * @param pageSize
   * @return response with pagination
   */
  async getUserWords(
    userId: number,
    page: number = 1,
    pageSize: number = 20,
    status?: string,
  ) {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }
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
    const data = userWords.map((uw) => ({
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
      audio: {
        tts: uw.wordMeaning.ttsAudioUrl,
        uk: uw.wordMeaning.ukAudioUrl,
        us: uw.wordMeaning.usAudioUrl,
      },
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
   * Delete a UserWord from the user's learning list.
   * Only allow deletion if the word has not been reviewed yet (totalReviews === 0).
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
        'Không thể xóa từ đã được ôn tập. Chỉ có thể xóa từ chưa ôn tập lần nào.',
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
}
