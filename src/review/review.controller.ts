import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { ReviewService } from './review.service';

@Controller('review')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * GET /review/today
   * Trả về danh sách tối đa 20 từ cần ôn tập hôm nay (SM-2 priority sort).
   */
  @Get('today')
  getTodayQueue(@CurrentUser() user: JwtPayload) {
    return this.reviewService.getTodayQueue(user.sub);
  }

  /**
   * GET /review/sessions
   * Danh sách lịch sử các phiên ôn tập (có phân trang).
   */
  @Get('sessions')
  getSessions(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    return this.reviewService.getSessions(
      user.sub,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20
    );
  }

  /**
   * GET /review/sessions/:id
   * Chi tiết 1 phiên ôn tập (danh sách từng từ đúng/sai).
   */
  @Get('sessions/:id')
  getSessionDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reviewService.getSessionDetail(user.sub, BigInt(id));
  }

  /**
   * POST /review/submit-bulk
   * Body: { results: [{ userWordId: number, correct: boolean }], durationSeconds?: number }
   * Cập nhật SM-2 cho nhiều từ sau 1 lần kiểm tra, lưu lịch sử phiên.
   */
  @Post('submit-bulk')
  @HttpCode(200)
  submitBulk(
    @CurrentUser() user: JwtPayload,
    @Body('results') results: { userWordId: number; correct: boolean }[],
    @Body('durationSeconds') durationSeconds?: number
  ) {
    return this.reviewService.submitBulk(user.sub, results, durationSeconds);
  }

  /**
   * POST /review/:userWordId
   * Body: { correct: boolean }
   * Cập nhật SM-2 cho 1 từ sau khi người dùng trả lời.
   */
  @Post(':userWordId')
  @HttpCode(200)
  submitReview(
    @CurrentUser() user: JwtPayload,
    @Param('userWordId') userWordId: string,
    @Body('correct') correct: boolean
  ) {
    return this.reviewService.submitReview(user.sub, Number(userWordId), correct);
  }
}
