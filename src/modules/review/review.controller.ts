import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ReviewQueryDto } from './dto/review-query.dto';
import { ReviewService } from './review.service';

@ApiTags('Review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @ApiOperation({
    summary: 'Danh sách từ đến hạn học hôm nay (có phân trang, filter status)',
  })
  @Get('today')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách từ đến hạn hôm nay thành công')
  getTodayDueWords(
    @CurrentUser('userId') userId: number,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewService.getTodayDueWords(userId, query);
  }

  @ApiOperation({ summary: 'Danh sách từ cần ôn tập theo mức ưu tiên' })
  @Get('practice-queue')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách từ cần ôn tập thành công')
  getPracticeQueue(
    @CurrentUser('userId') userId: number,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewService.getPracticeQueue(userId, query);
  }
}
