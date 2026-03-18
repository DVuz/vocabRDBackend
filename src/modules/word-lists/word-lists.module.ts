import { Module } from '@nestjs/common';
import { WordListsController } from './word-lists.controller';
import { WordListsService } from './word-lists.service';

@Module({
  controllers: [WordListsController],
  providers: [WordListsService],
  exports: [WordListsService],
})
export class WordListsModule {}
