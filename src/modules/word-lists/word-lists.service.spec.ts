import { Test, TestingModule } from '@nestjs/testing';
import { WordListsService } from './word-lists.service';

describe('WordListsService', () => {
  let service: WordListsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WordListsService],
    }).compile();

    service = module.get<WordListsService>(WordListsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
