import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { UserWordController } from './user-word.controller';

describe('UserWordController', () => {
  let controller: UserWordController;

  const prismaMock = {
    userWord: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserWordController],
      providers: [
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    controller = module.get<UserWordController>(UserWordController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns existed user word if already saved', async () => {
    const existed = { id: 1, userId: 7, wordMeaningId: 10 };
    prismaMock.userWord.findFirst.mockResolvedValue(existed);

    const result = await controller.addUserWord(7, { meaningId: 10 });

    expect(prismaMock.userWord.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 7,
        wordMeaningId: 10,
      },
    });
    expect(prismaMock.userWord.create).not.toHaveBeenCalled();
    expect(result).toEqual(existed);
  });

  it('creates user word when not existed', async () => {
    prismaMock.userWord.findFirst.mockResolvedValue(null);
    const created = { id: 2, userId: 7, wordMeaningId: 10 };
    prismaMock.userWord.create.mockResolvedValue(created);

    const result = await controller.addUserWord(7, { meaningId: 10 });

    expect(prismaMock.userWord.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        wordMeaningId: 10,
      },
    });
    expect(result).toEqual(created);
  });
});
