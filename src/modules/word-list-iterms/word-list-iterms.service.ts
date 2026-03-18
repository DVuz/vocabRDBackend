import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateWordListItermDto } from './dto/create-word-list-iterm.dto';
import { UpdateWordListItermDto } from './dto/update-word-list-iterm.dto';

@Injectable()
export class WordListItermsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, createWordListItermDto: CreateWordListItermDto) {
    const { listId, wordMeaningId } = createWordListItermDto;

    await this.ensureUserOwnsWordList(userId, listId);

    try {
      return await this.prisma.wordListItem.create({
        data: { listId, wordMeaningId },
        select: {
          id: true,
          listId: true,
          wordMeaningId: true,
          addedAt: true,
          wordMeaning: {
            select: {
              id: true,
              definition: true,
              vnDefinition: true,
              word: { select: { word: true } },
            },
          },
        },
      });
    } catch (error) {
      this.handlePrismaWriteError(error);
    }
  }

  async findAll(userId: number) {
    return this.prisma.wordListItem.findMany({
      where: {
        wordList: { userId },
      },
      orderBy: { addedAt: 'desc' },
      select: {
        id: true,
        listId: true,
        wordMeaningId: true,
        addedAt: true,
        wordMeaning: {
          select: {
            id: true,
            definition: true,
            vnDefinition: true,
            word: { select: { word: true } },
          },
        },
      },
    });
  }

  async findOne(userId: number, id: number) {
    const item = await this.prisma.wordListItem.findFirst({
      where: {
        id,
        wordList: { userId },
      },
      select: {
        id: true,
        listId: true,
        wordMeaningId: true,
        addedAt: true,
        wordMeaning: {
          select: {
            id: true,
            definition: true,
            vnDefinition: true,
            word: { select: { word: true } },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Word list item not found');
    }

    return item;
  }

  async update(
    userId: number,
    id: number,
    updateWordListItermDto: UpdateWordListItermDto,
  ) {
    const existing = await this.prisma.wordListItem.findFirst({
      where: {
        id,
        wordList: { userId },
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Word list item not found');
    }

    const data: Prisma.WordListItemUpdateInput = {};
    if (updateWordListItermDto.wordMeaningId !== undefined) {
      data.wordMeaning = { connect: { id: updateWordListItermDto.wordMeaningId } };
    }

    try {
      return await this.prisma.wordListItem.update({
        where: { id },
        data,
        select: {
          id: true,
          listId: true,
          wordMeaningId: true,
          addedAt: true,
          wordMeaning: {
            select: {
              id: true,
              definition: true,
              vnDefinition: true,
              word: { select: { word: true } },
            },
          },
        },
      });
    } catch (error) {
      this.handlePrismaWriteError(error);
    }
  }

  async remove(userId: number, id: number) {
    const existing = await this.prisma.wordListItem.findFirst({
      where: {
        id,
        wordList: { userId },
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Word list item not found');
    }

    await this.prisma.wordListItem.delete({ where: { id } });
    return { message: 'Word list item deleted successfully' };
  }

  private async ensureUserOwnsWordList(userId: number, listId: number) {
    const wordList = await this.prisma.wordList.findFirst({
      where: { id: listId, userId },
      select: { id: true },
    });

    if (!wordList) {
      throw new NotFoundException('Word list not found');
    }
  }

  private handlePrismaWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException('Meaning already exists in this word list');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Word meaning not found');
    }

    throw error;
  }
}
