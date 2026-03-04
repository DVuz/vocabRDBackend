import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReviewModule } from './review/review.module';
import { UserWordModule } from './user-words/user-word.module';
import { WordListModule } from './word-lists/word-list.module';
import { WordModule } from './words/word.module';

@Module({
  imports: [PrismaModule, AuthModule, WordModule, UserWordModule, WordListModule, ReviewModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
