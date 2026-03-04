import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { UserWordService } from './user-word.service';

@Controller()
export class UserWordController {
  constructor(private readonly userWordService: UserWordService) {}

  /**
   * POST /user-words
   * Thêm 1 meaning vào danh sách từ của user đang đăng nhập.
   * Yêu cầu header: Authorization: Bearer <token>
   */
  @Post('user-words')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async addUserWord(@CurrentUser() user: JwtPayload, @Body('meaningId') meaningId: number) {
    return this.userWordService.addUserWord(user.sub, Number(meaningId));
  }

  /**
   * GET /user-words?page=1&pageSize=20&status=new&isFavorite=true
   * Lấy danh sách từ của user đang đăng nhập (từ JWT token).
   */
  @Get('user-words')
  @UseGuards(JwtAuthGuard)
  async getMyWords(
    @CurrentUser() user: JwtPayload,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('status') status?: string,
    @Query('isFavorite') isFavorite?: string
  ) {
    return this.userWordService.getMyWords(
      user.sub,
      parseInt(page),
      parseInt(pageSize),
      status,
      isFavorite === 'true' ? true : isFavorite === 'false' ? false : undefined
    );
  }

  /**
   * GET /users/:userId/words
   */
  @Get('users/:userId/words')
  async getUserWords(
    @Param('userId') userId: string,
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '20',
    @Query('status') status?: string,
    @Query('isFavorite') isFavorite?: string
  ) {
    return this.userWordService.getUserWords(
      parseInt(userId),
      parseInt(skip),
      parseInt(take),
      status,
      isFavorite === 'true'
    );
  }
}
