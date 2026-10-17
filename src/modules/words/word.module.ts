import { Module } from '@nestjs/common';
import { WordController } from './word.controller';
import { WordService } from './word.service';
import { WordLookupService } from './services/word-lookup.service';
import { CambridgeCrawlerService } from './services/cambridge-crawler.service';
import { LongmanCrawlerService } from './services/longman-crawler.service';
import { GeminiWordService } from './services/gemini-word.service';
import { UserWordModule } from '../user-words/user-words.module';

@Module({
  imports: [UserWordModule],
  controllers: [WordController],
  providers: [
    WordService,
    WordLookupService,
    CambridgeCrawlerService,
    LongmanCrawlerService,
    GeminiWordService,
  ],
})
export class WordModule {}
