import { Test, TestingModule } from '@nestjs/testing';
import { WordListItermsController } from './word-list-iterms.controller';
import { WordListItermsService } from './word-list-iterms.service';

describe('WordListItermsController', () => {
  let controller: WordListItermsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WordListItermsController],
      providers: [WordListItermsService],
    }).compile();

    controller = module.get<WordListItermsController>(WordListItermsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
