import { Test, TestingModule } from '@nestjs/testing';
import { WordListsController } from './word-lists.controller';

describe('WordListsController', () => {
  let controller: WordListsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WordListsController],
    }).compile();

    controller = module.get<WordListsController>(WordListsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
