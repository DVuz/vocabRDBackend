import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { AddUserWordDto } from './dto/add-user-word.dto';
import { RemoveUserWordDto } from './dto/remove-user-word.dto';
import { UserWordsService } from './user-words.service';

@ApiTags('User Words')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user-words')
export class UserWordController {
  constructor(private readonly userWordsService: UserWordsService) {}

  @ApiOperation({
    summary: 'Lưu từ vào danh sách của user đang đăng nhập (lấy userId từ JWT)',
  })
  @ApiResponse({ status: 201, description: 'Lưu thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Lưu từ thành công')
  async addUserWord(
    @CurrentUser('userId') userId: number,
    @Body() dto: AddUserWordDto,
  ) {
    return this.userWordsService.addUserWord(userId, dto.meaningId);
  }

  @ApiOperation({
    summary:
      'Lấy danh sách từ đã lưu của user đang đăng nhập (lấy userId từ JWT)',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'status', required: false, type: String, example: 'new' })
  @Get()
  @ResponseMessage('Lấy danh sách từ thành công')
  async getUserWords(
    @CurrentUser('userId') userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('status') status?: string,
  ) {
    return this.userWordsService.getUserWords(userId, page, pageSize, status);
  }

  @ApiOperation({
    summary: 'Xóa một từ đã lưu của user đang đăng nhập (lấy userId từ JWT)',
  })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy từ đã lưu' })
  @ApiResponse({ status: 403, description: 'Không có quyền xóa từ này' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiParam({
    name: 'userWordId',
    type: Number,
    description: 'ID bản ghi userWord',
  })
  @Delete(':userWordId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Xóa từ thành công')
  async removeUserWord(
    @CurrentUser('userId') userId: number,
    @Param() dto: RemoveUserWordDto,
  ) {
    return this.userWordsService.removeUserWord(userId, dto.userWordId);
  }
}
