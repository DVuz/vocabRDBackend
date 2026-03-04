import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class WordListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new WordList for a user
   */
  async createWordList(userId: number, name: string, description?: string) {
    return this.prisma.wordList.create({
      data: { userId, name, description },
      select: { id: true, name: true, description: true, isPublic: true, createdAt: true },
    });
  }

  /**
   * Get all WordLists of a user with their words and meanings
   */
  async getWordLists(userId: number) {
    const lists = await this.prisma.wordList.findMany({
      where: { userId },
      include: {
        wordListItems: {
          include: {
            wordMeaning: {
              include: { word: true },
            },
          },
          orderBy: { addedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return lists.map(list => ({
      id: list.id,
      name: list.name,
      description: list.description,
      isPublic: list.isPublic,
      totalItems: list.wordListItems.length,
      createdAt: list.createdAt,
      items: list.wordListItems.map(item => ({
        id: item.id,
        word: item.wordMeaning.word.word,
        meaningId: item.wordMeaning.id,
        partOfSpeech: item.wordMeaning.partOfSpeech,
        definition: item.wordMeaning.definition,
        vnDefinition: item.wordMeaning.vnDefinition,
        addedAt: item.addedAt,
      })),
    }));
  }

  /**
   * Add a meaning to a WordList
   */
  async addMeaningToList(listId: number, wordMeaningId: number) {
    const list = await this.prisma.wordList.findUnique({ where: { id: listId } });
    if (!list) throw new NotFoundException(`WordList ${listId} not found`);

    const meaning = await this.prisma.wordMeaning.findUnique({ where: { id: wordMeaningId } });
    if (!meaning) throw new NotFoundException(`WordMeaning ${wordMeaningId} not found`);

    return this.prisma.wordListItem.create({
      data: { listId, wordMeaningId },
      select: { id: true, listId: true, wordMeaningId: true, addedAt: true },
    });
  }

  /**
   * Remove a meaning from a WordList
   */
  async removeMeaningFromList(listId: number, wordMeaningId: number) {
    const item = await this.prisma.wordListItem.findFirst({
      where: { listId, wordMeaningId },
    });
    if (!item) {
      throw new NotFoundException(`WordMeaning ${wordMeaningId} not found in list ${listId}`);
    }

    await this.prisma.wordListItem.delete({ where: { id: item.id } });
    return { message: 'Removed successfully' };
  }

  /**
   * Delete a WordList (only if it has no items)
   */
  async deleteWordList(listId: number) {
    const list = await this.prisma.wordList.findUnique({
      where: { id: listId },
      include: { _count: { select: { wordListItems: true } } },
    });

    if (!list) throw new NotFoundException(`WordList ${listId} not found`);

    if (list._count.wordListItems > 0) {
      throw new BadRequestException(
        `Cannot delete WordList ${listId} because it still has ${list._count.wordListItems} item(s). Remove all items first.`
      );
    }

    await this.prisma.wordList.delete({ where: { id: listId } });
    return { message: 'WordList deleted successfully' };
  }
}
