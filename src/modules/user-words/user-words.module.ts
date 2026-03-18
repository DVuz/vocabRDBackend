import { Module } from '@nestjs/common';
import { UserWordController } from './user-word.controller';
import { UserWordsService } from './user-words.service';

@Module({
  controllers: [UserWordController],
  providers: [UserWordsService],
  exports: [UserWordsService],
})
export class UserWordModule {}
