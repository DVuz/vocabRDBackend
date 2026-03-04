import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CrawlerService } from './crawler.service';
import { WordController } from './word.controller';
import { WordService } from './word.service';

@Module({
  imports: [PrismaModule],
  controllers: [WordController],
  providers: [WordService, CrawlerService],
  exports: [WordService],
})
export class WordModule {}
