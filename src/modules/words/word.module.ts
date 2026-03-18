import { Module } from '@nestjs/common';
import { WordController } from './word.controller';
import { WordService } from './word.service';
import { WordLookupService } from './services/word-lookup.service';
import { CambridgeCrawlerService } from './services/cambridge-crawler.service';

@Module({
  imports: [],
  controllers: [WordController],
  providers: [WordService, WordLookupService, CambridgeCrawlerService],
})
export class WordModule {}
