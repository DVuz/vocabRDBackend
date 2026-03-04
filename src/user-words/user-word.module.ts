import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserWordController } from './user-word.controller';
import { UserWordService } from './user-word.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UserWordController],
  providers: [UserWordService],
  exports: [UserWordService],
})
export class UserWordModule {}
