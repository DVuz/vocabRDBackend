import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ParsePositiveIntPipe } from 'src/common/pipes/parse-positive-int.pipe';
import { CreateTtsConfigDto } from './dto/create-tts-config.dto';
import { CreateTtsVoiceModelDto } from './dto/create-tts-voice-model.dto';
import { UpdateTtsConfigDto } from './dto/update-tts-config.dto';
import { UpdateTtsVoiceModelDto } from './dto/update-tts-voice-model.dto';
import { TtsConfigsService } from './tts-configs.service';

@ApiTags('TTS Configs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('my/tts-configs')
export class TtsConfigsController {
  constructor(private readonly ttsConfigsService: TtsConfigsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all TTS configs of current user' })
  @ResponseMessage('Lấy danh sách TTS config thành công')
  async getMyConfigs(@CurrentUser('userId') userId: number) {
    return this.ttsConfigsService.getMyConfigs(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new TTS config' })
  @ResponseMessage('Tạo TTS config thành công')
  async createConfig(
    @CurrentUser('userId') userId: number,
    @Body() dto: CreateTtsConfigDto,
  ) {
    return this.ttsConfigsService.createConfig(userId, dto);
  }

  @Put(':configId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update TTS config' })
  @ResponseMessage('Cập nhật TTS config thành công')
  async updateConfig(
    @CurrentUser('userId') userId: number,
    @Param('configId', ParsePositiveIntPipe) configId: number,
    @Body() dto: UpdateTtsConfigDto,
  ) {
    return this.ttsConfigsService.updateConfig(userId, configId, dto);
  }

  @Delete(':configId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete TTS config' })
  @ResponseMessage('Xóa TTS config thành công')
  async deleteConfig(
    @CurrentUser('userId') userId: number,
    @Param('configId', ParsePositiveIntPipe) configId: number,
  ) {
    return this.ttsConfigsService.deleteConfig(userId, configId);
  }

  @Post(':configId/voice-models')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a voice/model under a config' })
  @ResponseMessage('Thêm voice/model thành công')
  async addVoiceModel(
    @CurrentUser('userId') userId: number,
    @Param('configId', ParsePositiveIntPipe) configId: number,
    @Body() dto: CreateTtsVoiceModelDto,
  ) {
    return this.ttsConfigsService.addVoiceModel(userId, configId, dto);
  }

  @Put('voice-models/:voiceModelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update voice/model' })
  @ResponseMessage('Cập nhật voice/model thành công')
  async updateVoiceModel(
    @CurrentUser('userId') userId: number,
    @Param('voiceModelId', ParsePositiveIntPipe) voiceModelId: number,
    @Body() dto: UpdateTtsVoiceModelDto,
  ) {
    return this.ttsConfigsService.updateVoiceModel(userId, voiceModelId, dto);
  }

  @Delete('voice-models/:voiceModelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete voice/model' })
  @ResponseMessage('Xóa voice/model thành công')
  async deleteVoiceModel(
    @CurrentUser('userId') userId: number,
    @Param('voiceModelId', ParsePositiveIntPipe) voiceModelId: number,
  ) {
    return this.ttsConfigsService.deleteVoiceModel(userId, voiceModelId);
  }
}
