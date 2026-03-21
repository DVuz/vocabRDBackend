import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTtsConfigDto } from './dto/create-tts-config.dto';
import { UpdateTtsConfigDto } from './dto/update-tts-config.dto';
import { CreateTtsVoiceModelDto } from './dto/create-tts-voice-model.dto';
import { UpdateTtsVoiceModelDto } from './dto/update-tts-voice-model.dto';

@Injectable()
export class TtsConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeText(value: string | undefined) {
    return value?.trim();
  }

  async getMyConfigs(userId: number) {
    const configs = await this.prisma.userTtsConfig.findMany({
      where: { userId },
      include: {
        voiceModels: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return configs.map((config) => ({
      id: config.id,
      name: config.name,
      provider: config.provider,
      apiKeyMasked: this.maskApiKey(config.apiKey),
      isActive: config.isActive,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      voiceModels: config.voiceModels,
    }));
  }

  async createConfig(userId: number, dto: CreateTtsConfigDto) {
    return this.prisma.userTtsConfig.create({
      data: {
        userId,
        name: dto.name.trim(),
        apiKey: dto.apiKey.trim(),
        provider: 'elevenlabs',
        isActive: dto.isActive ?? true,
        isSystemDefault: false,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async updateConfig(userId: number, configId: number, dto: UpdateTtsConfigDto) {
    const existing = await this.prisma.userTtsConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!existing) {
      throw new NotFoundException('TTS config not found');
    }

    return this.prisma.userTtsConfig.update({
      where: { id: configId },
      data: {
        name: this.normalizeText(dto.name),
        apiKey: this.normalizeText(dto.apiKey),
        isActive: dto.isActive,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async deleteConfig(userId: number, configId: number) {
    const existing = await this.prisma.userTtsConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!existing) {
      throw new NotFoundException('TTS config not found');
    }

    await this.prisma.userTtsConfig.delete({ where: { id: configId } });
    return { message: 'Deleted TTS config successfully', configId };
  }

  async addVoiceModel(
    userId: number,
    configId: number,
    dto: CreateTtsVoiceModelDto,
  ) {
    const config = await this.prisma.userTtsConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!config) {
      throw new NotFoundException('TTS config not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.userTtsVoiceModel.updateMany({
          where: { configId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.userTtsVoiceModel.create({
        data: {
          configId,
          label: dto.label.trim(),
          voiceId: dto.voiceId.trim(),
          modelId: dto.modelId.trim(),
          isDefault: dto.isDefault ?? false,
        },
      });

      const total = await tx.userTtsVoiceModel.count({ where: { configId } });
      if (total === 1 && !created.isDefault) {
        await tx.userTtsVoiceModel.update({
          where: { id: created.id },
          data: { isDefault: true },
        });
        return { ...created, isDefault: true };
      }

      return created;
    });
  }

  async updateVoiceModel(
    userId: number,
    voiceModelId: number,
    dto: UpdateTtsVoiceModelDto,
  ) {
    const existing = await this.prisma.userTtsVoiceModel.findFirst({
      where: { id: voiceModelId, config: { userId } },
      include: { config: true },
    });

    if (!existing) {
      throw new NotFoundException('Voice model not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.userTtsVoiceModel.updateMany({
          where: { configId: existing.configId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.userTtsVoiceModel.update({
        where: { id: voiceModelId },
        data: {
          label: this.normalizeText(dto.label),
          voiceId: this.normalizeText(dto.voiceId),
          modelId: this.normalizeText(dto.modelId),
          isDefault: dto.isDefault,
        },
      });
    });
  }

  async deleteVoiceModel(userId: number, voiceModelId: number) {
    const existing = await this.prisma.userTtsVoiceModel.findFirst({
      where: { id: voiceModelId, config: { userId } },
    });

    if (!existing) {
      throw new NotFoundException('Voice model not found');
    }

    const count = await this.prisma.userTtsVoiceModel.count({
      where: { configId: existing.configId },
    });
    if (count <= 1) {
      throw new BadRequestException(
        'Cannot delete the only voice model in this config',
      );
    }

    await this.prisma.userTtsVoiceModel.delete({ where: { id: voiceModelId } });

    if (existing.isDefault) {
      const replacement = await this.prisma.userTtsVoiceModel.findFirst({
        where: { configId: existing.configId },
        orderBy: { createdAt: 'asc' },
      });

      if (replacement) {
        await this.prisma.userTtsVoiceModel.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        });
      }
    }

    return { message: 'Deleted voice model successfully', voiceModelId };
  }

  private maskApiKey(apiKey: string) {
    if (apiKey.length <= 8) {
      return '*'.repeat(apiKey.length);
    }

    return `${apiKey.slice(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.slice(-4)}`;
  }
}
