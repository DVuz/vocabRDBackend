import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import jwtConfig from './config/jwt.config';
import googleConfig from './config/google.config';
import elevenlabsConfig from './config/elevenlabs.config';
import cloudinaryConfig from './config/cloudinary.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { WordModule } from './modules/words/word.module';
import { UserWordModule } from './modules/user-words/user-words.module';
import { WordListsService } from './modules/word-lists/word-lists.service';
import { WordListsController } from './modules/word-lists/word-lists.controller';
import { WordListsModule } from './modules/word-lists/word-lists.module';
import { WordListItermsModule } from './modules/word-list-iterms/word-list-iterms.module';
import { ReviewModule } from './modules/review/review.module';
import { ReviewTestsModule } from './modules/review-tests/review-tests.module';
import { TtsConfigsModule } from './modules/tts-configs/tts-configs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [jwtConfig, googleConfig, elevenlabsConfig, cloudinaryConfig],
    }),
    PrismaModule,
    AuthModule,
    WordModule,
    UserWordModule,
    WordListsModule,
    WordListItermsModule,
    ReviewModule,
    ReviewTestsModule,
    TtsConfigsModule,
  ],
  controllers: [AppController, WordListsController],
  providers: [AppService, WordListsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
