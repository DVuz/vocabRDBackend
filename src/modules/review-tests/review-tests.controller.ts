import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ReviewTestQueryDto } from './dto/review-test-query.dto';
import { SessionsQueryDto } from './dto/sessions-query.dto';
import { SubmitReviewSessionDto } from './dto/submit-review-session.dto';
import { ReviewTestsService } from './review-tests.service';

@ApiTags('Review Tests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('review-tests')
export class ReviewTestsController {
  constructor(private readonly reviewTestsService: ReviewTestsService) {}

  @ApiOperation({ summary: 'Lấy danh sách từ cần kiểm tra theo ưu tiên' })
  @Get('queue')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách từ cần kiểm tra thành công')
  getTestQueue(
    @CurrentUser('userId') userId: number,
    @Query() query: ReviewTestQueryDto,
  ) {
    return this.reviewTestsService.getTestQueue(userId, query);
  }

  @ApiOperation({ summary: 'Submit kết quả kiểm tra và lưu session' })
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Lưu session kiểm tra thành công')
  submitSession(
    @CurrentUser('userId') userId: number,
    @Body() payload: SubmitReviewSessionDto,
  ) {
    return this.reviewTestsService.submitSession(userId, payload);
  }

  @ApiOperation({ summary: 'Lấy danh sách session kiểm tra' })
  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách session kiểm tra thành công')
  getSessions(
    @CurrentUser('userId') userId: number,
    @Query() query: SessionsQueryDto,
  ) {
    return this.reviewTestsService.getSessions(userId, query);
  }

  @ApiOperation({ summary: 'Lấy chi tiết session kiểm tra' })
  @Get('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy chi tiết session kiểm tra thành công')
  getSessionDetail(
    @CurrentUser('userId') userId: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    return this.reviewTestsService.getSessionDetail(userId, BigInt(sessionId));
  }
}
