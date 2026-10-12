import { Module } from '@nestjs/common';
import { UserWordController } from './user-word.controller';
import { UserWordsService } from './user-words.service';
import { SharedTtsAudioService } from './services/shared-tts-audio.service';

@Module({
  controllers: [UserWordController],
  providers: [UserWordsService, SharedTtsAudioService],
  exports: [UserWordsService],
})
export class UserWordModule {}
