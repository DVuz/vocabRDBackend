import { Module } from '@nestjs/common';
import { TtsConfigsController } from './tts-configs.controller';
import { TtsConfigsService } from './tts-configs.service';

@Module({
  controllers: [TtsConfigsController],
  providers: [TtsConfigsService],
  exports: [TtsConfigsService],
})
export class TtsConfigsModule {}
