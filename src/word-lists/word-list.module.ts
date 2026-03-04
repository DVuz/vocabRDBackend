import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WordListController } from './word-list.controller';
import { WordListService } from './word-list.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WordListController],
  providers: [WordListService],
  exports: [WordListService],
})
export class WordListModule {}
