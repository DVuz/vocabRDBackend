import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
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
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import type { Response } from 'express';
import { GoogleDriveService } from './google-drive.service';

@ApiTags('Google Drive')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('google-drive')
export class GoogleDriveController {
  constructor(private readonly googleDriveService: GoogleDriveService) {}

  @Get('files')
  @ApiOperation({
    summary: 'Lấy danh sách file trong Google Drive folder',
    description:
      'Chỉ trả về metadata của file, không trả về nội dung. Có thể truyền search để tìm theo tên file.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Từ khóa tìm trong tên file',
    example: 'lesson',
  })
  @ApiResponse({
    status: 200,
    description:
      'Mảng metadata gồm id, name, mimeType, size, modifiedTime và webViewLink',
  })
  async listFiles(
    @Query('search') search?: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.googleDriveService.listFiles(search, folderId);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Lấy toàn bộ cây folder và file đệ quy' })
  @ApiQuery({
    name: 'folderId',
    required: false,
    description: 'Folder bắt đầu quét',
  })
  async getTree(@Query('folderId') folderId?: string) {
    return this.googleDriveService.getTree(folderId);
  }

  @Get('folders/:folderId/files')
  @ApiOperation({ summary: 'Lấy file và folder trực tiếp trong một folder' })
  @ApiParam({ name: 'folderId', description: 'Google Drive folder ID' })
  @ApiQuery({ name: 'search', required: false })
  async listFolderFiles(
    @Param('folderId') folderId: string,
    @Query('search') search?: string,
  ) {
    return this.googleDriveService.listFiles(search, folderId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Tìm file theo tên trong toàn bộ cây folder' })
  @ApiQuery({ name: 'q', required: true, example: 'lesson' })
  @ApiQuery({ name: 'folderId', required: false })
  async searchFiles(
    @Query('q') query: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.googleDriveService.searchFiles(query, folderId);
  }

  @Get('files/:fileId')
  @ApiOperation({
    summary: 'Lấy thông tin metadata của một file trên Google Drive',
  })
  @ApiParam({
    name: 'fileId',
    description: 'Google Drive file ID',
    example: '1ZKpg4yZa0AXgJJNpMeDO7uePvflDEYAt',
  })
  @ApiResponse({
    status: 200,
    description: 'Metadata của file, không bao gồm nội dung file',
  })
  async getFile(@Param('fileId') fileId: string) {
    return this.googleDriveService.getFile(fileId);
  }

  @Get('files/:fileId/content')
  @ApiOperation({
    summary: 'Đọc nội dung file Markdown hoặc text',
    description:
      'Tải nội dung file từ Google Drive và trả về dạng text trong trường content.',
  })
  @ApiParam({
    name: 'fileId',
    description: 'Google Drive file ID',
    example: '1ZKpg4yZa0AXgJJNpMeDO7uePvflDEYAt',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin file kèm toàn bộ nội dung text/Markdown',
    schema: {
      example: {
        id: '1ZKpg4yZa0AXgJJNpMeDO7uePvflDEYAt',
        name: 'vocabulary.md',
        mimeType: 'text/markdown',
        modifiedTime: '2026-10-06T07:00:00.000Z',
        content: '# Vocabulary\n\n## abandon\nTo leave something behind.',
      },
    },
  })
  async getFileContent(@Param('fileId') fileId: string) {
    return this.googleDriveService.getFileContent(fileId);
  }

  @Get('files/:fileId/lesson')
  @ApiOperation({
    summary: 'Lấy bài học Markdown kèm các audio được tham chiếu',
  })
  @ApiParam({ name: 'fileId', description: 'Markdown file ID' })
  async getLesson(@Param('fileId') fileId: string) {
    return this.googleDriveService.getLesson(fileId);
  }

  @Get('files/:fileId/stream')
  @ApiOperation({ summary: 'Stream audio hoặc file media từ Google Drive' })
  @ApiParam({ name: 'fileId', description: 'Google Drive file ID' })
  async streamFile(
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { metadata, stream } =
      await this.googleDriveService.streamFile(fileId);
    response.setHeader(
      'Content-Type',
      metadata.mimeType ?? 'application/octet-stream',
    );
    if (metadata.size) {
      response.setHeader('Content-Length', metadata.size);
    }
    return new StreamableFile(stream);
  }

  @Get('files/:fileId/download')
  @ApiOperation({ summary: 'Download file từ Google Drive' })
  @ApiParam({ name: 'fileId', description: 'Google Drive file ID' })
  async downloadFile(
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { metadata, stream } =
      await this.googleDriveService.streamFile(fileId);
    response.setHeader(
      'Content-Type',
      metadata.mimeType ?? 'application/octet-stream',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(metadata.name ?? 'download')}"`,
    );
    return new StreamableFile(stream);
  }
}
