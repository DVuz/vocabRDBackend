import { Module } from '@nestjs/common';
import { WordListItermsService } from './word-list-iterms.service';
import { WordListItermsController } from './word-list-iterms.controller';

@Module({
  controllers: [WordListItermsController],
  providers: [WordListItermsService],
})
export class WordListItermsModule {}
