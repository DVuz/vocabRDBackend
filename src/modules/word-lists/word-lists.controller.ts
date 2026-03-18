import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  Get,
  Put,
  Delete,
  Param,
} from '@nestjs/common';
import { WordListsService } from './word-lists.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateWordListDto } from './dto/create-word-list.dto';
import { UpdateWordListDto } from './dto/update-word-list.dto';
import { ParsePositiveIntPipe } from 'src/common/pipes/parse-positive-int.pipe';

@ApiTags('Word Lists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('my/word-lists')
export class WordListsController {
  constructor(private readonly wordListsService: WordListsService) {}

  @ApiOperation({
    summary:
      'Tạo một word list mới cho user đang đăng nhập (lấy userId từ JWT)',
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Tạo word list thành công')
  async createWordList(
    @CurrentUser('userId') userId: number,
    @Body() dto: CreateWordListDto,
  ) {
    return this.wordListsService.createWordList(
      userId,
      dto.name,
      dto.description,
    );
  }

  @ApiOperation({
    summary: 'Lấy tất cả word list của user đang đăng nhập (lấy userId từ JWT)',
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách word list thành công')
  async getWordListsByUser(@CurrentUser('userId') userId: number) {
    return this.wordListsService.getWordListsByUser(userId);
  }

  @ApiOperation({
    summary:
      'Cập nhật thông tin word list (name, description, isPublic) được gửi lên',
  })
  @Put()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cập nhật word list thành công')
  async updateWordList(
    @CurrentUser('userId') userId: number,
    @Body() dto: UpdateWordListDto,
  ) {
    return this.wordListsService.updateWordList(
      userId,
      dto.wordListId,
      dto.name,
      dto.description,
      dto.isPublic,
    );
  }

  @ApiOperation({
    summary:
      'Xóa một word list của user (chỉ cho phép xóa word list trống, tức là không có từ nào trong đó)',
  })
  @Delete(':wordListId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Xóa word list thành công')
  async deleteWordList(
    @CurrentUser('userId') userId: number,
    @Param('wordListId', ParsePositiveIntPipe) wordListId: number,
  ) {
    console.log('Deleting word list with ID:', wordListId);
    return this.wordListsService.deleteWordList(userId, wordListId);
  }
}
