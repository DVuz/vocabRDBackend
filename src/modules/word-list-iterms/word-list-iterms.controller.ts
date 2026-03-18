import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ParsePositiveIntPipe } from 'src/common/pipes/parse-positive-int.pipe';
import { WordListItermsService } from './word-list-iterms.service';
import { CreateWordListItermDto } from './dto/create-word-list-iterm.dto';
import { UpdateWordListItermDto } from './dto/update-word-list-iterm.dto';
import {
  DeleteWordListItermResponseDto,
  WordListItermResponseDto,
} from './dto/word-list-iterm-response.dto';

@ApiTags('Word List Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('my/word-list-iterms')
export class WordListItermsController {
  constructor(private readonly wordListItermsService: WordListItermsService) {}

  @ApiOperation({ summary: 'Thêm một meaning vào word list của user' })
  @ApiCreatedResponse({ type: WordListItermResponseDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Thêm meaning vào word list thành công')
  create(
    @CurrentUser('userId') userId: number,
    @Body() createWordListItermDto: CreateWordListItermDto,
  ) {
    return this.wordListItermsService.create(userId, createWordListItermDto);
  }

  @ApiOperation({ summary: 'Lấy tất cả word list item của user' })
  @ApiOkResponse({ type: WordListItermResponseDto, isArray: true })
  @Get()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy danh sách word list item thành công')
  findAll(@CurrentUser('userId') userId: number) {
    return this.wordListItermsService.findAll(userId);
  }

  @ApiOperation({ summary: 'Lấy chi tiết một word list item' })
  @ApiOkResponse({ type: WordListItermResponseDto })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Lấy chi tiết word list item thành công')
  findOne(
    @CurrentUser('userId') userId: number,
    @Param('id', ParsePositiveIntPipe) id: number,
  ) {
    return this.wordListItermsService.findOne(userId, id);
  }

  @ApiOperation({ summary: 'Cập nhật một word list item của user' })
  @ApiOkResponse({ type: WordListItermResponseDto })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cập nhật word list item thành công')
  update(
    @CurrentUser('userId') userId: number,
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() updateWordListItermDto: UpdateWordListItermDto,
  ) {
    return this.wordListItermsService.update(userId, id, updateWordListItermDto);
  }

  @ApiOperation({ summary: 'Xóa một word list item của user' })
  @ApiOkResponse({ type: DeleteWordListItermResponseDto })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Xóa word list item thành công')
  remove(
    @CurrentUser('userId') userId: number,
    @Param('id', ParsePositiveIntPipe) id: number,
  ) {
    return this.wordListItermsService.remove(userId, id);
  }
}
