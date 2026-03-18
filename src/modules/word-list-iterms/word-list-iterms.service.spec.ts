import { Test, TestingModule } from '@nestjs/testing';
import { WordListItermsService } from './word-list-iterms.service';

describe('WordListItermsService', () => {
  let service: WordListItermsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WordListItermsService],
    }).compile();

    service = module.get<WordListItermsService>(WordListItermsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
