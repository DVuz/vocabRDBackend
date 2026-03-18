import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Query,
} from '@nestjs/common';
import { WordService } from './word.service';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

@Controller()
export class WordController {
  constructor(private readonly wordService: WordService) {}

  //get word with all meanings
  @ApiOperation({ summary: 'Lấy thông tin từ vựng' })
  @ApiQuery({
    name: 'includeMeta',
    required: false,
    type: Boolean,
    description:
      'Hiển thị metadata hệ thống (createdAt/updatedAt). Mặc định: false',
  })
  @ApiResponse({ status: 200, description: 'Lấy thông tin từ vựng thành công' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy từ vựng' })
  @Get('words/:word')
  async getWordWithMeanings(
    @Param('word') word: string,
    @Query('includeMeta', new DefaultValuePipe(false), ParseBoolPipe)
    includeMeta: boolean,
  ) {
    return await this.wordService.getWordWithMeanings(word, includeMeta);
  }
}
