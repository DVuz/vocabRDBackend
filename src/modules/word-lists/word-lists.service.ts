import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WordListsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new Word List for a user.
   * @param userId - The ID of the user creating the word list.
   * @param name - The name of the word list.
   * @param description - An optional description of the word list.
   * @returns The created Word List object.
   * @throws BadRequestException if the name is missing or invalid.
   */
  async createWordList(userId: number, name: string, description?: string) {
    return this.prisma.wordList.create({
      data: { userId, name, description },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
      },
    });
  }
  /**
   * Get all word lists of a user with their details.
   * @param userId - The ID of the user.
   * @returns A list of word lists.
   */
  async getWordListsByUser(userId: number) {
    const wordLists = await this.prisma.wordList.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
        _count: {
          select: { wordListItems: true },
        },
      },
    });

    return wordLists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      isPublic: list.isPublic,
      createdAt: list.createdAt,
      wordCount: list._count.wordListItems,
    }));
  }

  /**
   * Update the name and description of a word list.
   * @param userId - The ID of the user.
   * @param wordListId - The ID of the word list to update.
   * @param name - The new name of the word list.
   * @param description - The new description of the word list.
   * @param isPublic - The new public status of the word list.
   * @returns The updated Word List object.
   * @throws NotFoundException if the word list does not exist or does not belong to the user.
   */
  async updateWordList(
    userId: number,
    wordListId: number,
    name?: string,
    description?: string,
    isPublic?: boolean,
  ) {
    const existing = await this.prisma.wordList.findFirst({
      where: { id: wordListId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Word list not found');
    }

    return this.prisma.wordList.update({
      where: { id: wordListId },
      data: { name, description, isPublic },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete a word list if it is empty.
   * @param userId - The ID of the user.
   * @param wordListId - The ID of the word list to delete.
   * @returns A success message.
   * @throws NotFoundException if the word list does not exist or does not belong to the user.
   * @throws BadRequestException if the word list is not empty.
   */
  async deleteWordList(userId: number, wordListId: number) {
    const existing = await this.prisma.wordList.findFirst({
      where: { id: wordListId, userId },
      include: { wordListItems: true },
    });
    if (!existing) {
      throw new NotFoundException('Word list not found');
    }
    if (existing.wordListItems.length > 0) {
      throw new BadRequestException('Cannot delete a non-empty word list');
    }

    await this.prisma.wordList.delete({ where: { id: wordListId } });
    return { message: 'Word list deleted successfully' };
  }
}
