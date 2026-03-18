import { Module } from '@nestjs/common';
import { ReviewTestsController } from './review-tests.controller';
import { ReviewTestsService } from './review-tests.service';

@Module({
  controllers: [ReviewTestsController],
  providers: [ReviewTestsService],
})
export class ReviewTestsModule {}
