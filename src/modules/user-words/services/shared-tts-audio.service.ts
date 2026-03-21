import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SharedTtsAudioService {
  private readonly logger = new Logger(SharedTtsAudioService.name);

  private cleanValue(value: string | undefined | null) {
    return value?.trim() ?? '';
  }

  private maskSecret(value: string | undefined | null) {
    if (!value) {
      return 'missing';
    }

    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }

    return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const cloudName = this.configService.get<string>('cloudinary.cloudName');
    const apiKey = this.configService.get<string>('cloudinary.apiKey');
    const apiSecret = this.configService.get<string>('cloudinary.apiSecret');

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.logger.log(
      `Cloudinary init cloud=${cloudName ?? 'missing'} key=${this.maskSecret(apiKey)} secret=${this.maskSecret(apiSecret)}`,
    );
  }

  async ensureMeaningTtsAudio(params: {
    userId: number;
    meaningId: number;
    definition: string;
    ttsAudioUrl: string | null;
  }) {
    this.logger.log(
      `[TTS] start user=${params.userId} meaning=${params.meaningId}`,
    );

    if (params.ttsAudioUrl) {
      this.logger.log(
        `[TTS] skip existing audio meaning=${params.meaningId} url=${params.ttsAudioUrl}`,
      );
      return params.ttsAudioUrl;
    }

    const profile = await this.resolveTtsProfile(params.userId);
    if (!profile) {
      this.logger.warn(
        `No active TTS profile found for user=${params.userId}, skip generation`,
      );
      return null;
    }

    this.logger.log(
      `[TTS] profile selected user=${params.userId} voice=${profile.voiceId} model=${profile.modelId} key=${this.maskSecret(profile.apiKey)}`,
    );

    const text = params.definition;
    this.logger.log(
      `[TTS] generating via ElevenLabs meaning=${params.meaningId} textLength=${text.length}`,
    );
    const audioBuffer = await this.generateFromElevenLabs(
      text,
      profile.apiKey,
      profile.voiceId,
      profile.modelId,
    );

    this.logger.log(
      `[TTS] ElevenLabs success meaning=${params.meaningId} bytes=${audioBuffer.length}`,
    );

    const uploaded = await this.uploadToCloudinary(audioBuffer, params.meaningId);

    this.logger.log(
      `[TTS] Cloudinary success meaning=${params.meaningId} publicId=${uploaded.public_id} url=${uploaded.secure_url}`,
    );

    const updated = await this.prisma.wordMeaning.updateMany({
      where: { id: params.meaningId, ttsAudioUrl: null },
      data: {
        ttsAudioUrl: uploaded.secure_url,
        ttsPublicId: uploaded.public_id,
      },
    });

    if (updated.count === 0) {
      this.logger.warn(
        `[TTS] db update skipped meaning=${params.meaningId} (audio already set by another request?)`,
      );
      const current = await this.prisma.wordMeaning.findUnique({
        where: { id: params.meaningId },
        select: { ttsAudioUrl: true },
      });
      return current?.ttsAudioUrl ?? null;
    }

    this.logger.log(`[TTS] done meaning=${params.meaningId}`);

    return uploaded.secure_url;
  }

  private async resolveTtsProfile(userId: number) {
    const userConfigs = await this.prisma.userTtsConfig.findMany({
      where: { userId, isActive: true },
      include: { voiceModels: true },
      orderBy: { createdAt: 'desc' },
    });

    const userProfiles = this.toProfiles(userConfigs);
    this.logger.log(
      `[TTS] user profiles user=${userId} configs=${userConfigs.length} profiles=${userProfiles.length}`,
    );
    const randomUserProfile = this.pickRandom(userProfiles);
    if (randomUserProfile) {
      this.logger.log(`[TTS] using user profile user=${userId}`);
      return randomUserProfile;
    }

    const systemConfigs = await this.prisma.userTtsConfig.findMany({
      where: { userId: null, isActive: true },
      include: { voiceModels: true },
      orderBy: { createdAt: 'desc' },
    });

    const systemProfiles = this.toProfiles(systemConfigs);
    this.logger.log(
      `[TTS] system profiles configs=${systemConfigs.length} profiles=${systemProfiles.length}`,
    );
    const randomSystemProfile = this.pickRandom(systemProfiles);
    if (randomSystemProfile) {
      this.logger.log('[TTS] using system default profile');
      return randomSystemProfile;
    }

    const envApiKey = this.configService.get<string>('elevenlabs.apiKey');
    const envVoiceId = this.configService.get<string>('elevenlabs.voiceId');
    const envModelId = this.configService.get<string>('elevenlabs.modelId');

    if (!envApiKey || !envVoiceId || !envModelId) {
      this.logger.warn('[TTS] no env fallback profile');
      return null;
    }

    this.logger.log(
      `[TTS] using env fallback profile voice=${envVoiceId} model=${envModelId} key=${this.maskSecret(envApiKey)}`,
    );

    return {
      apiKey: this.cleanValue(envApiKey),
      voiceId: this.cleanValue(envVoiceId),
      modelId: this.cleanValue(envModelId),
    };
  }

  private toProfiles(
    configs: Array<{
      apiKey: string;
      voiceModels: Array<{ voiceId: string; modelId: string }>;
    }>,
  ) {
    return configs.flatMap((config) =>
      config.voiceModels.map((voiceModel) => ({
        apiKey: this.cleanValue(config.apiKey),
        voiceId: this.cleanValue(voiceModel.voiceId),
        modelId: this.cleanValue(voiceModel.modelId),
      })),
    );
  }

  private pickRandom<T>(items: T[]): T | null {
    if (!items.length) {
      return null;
    }

    const index = Math.floor(Math.random() * items.length);
    return items[index];
  }

  private async generateFromElevenLabs(
    text: string,
    apiKey: string,
    voiceId: string,
    modelId: string,
  ) {
    const cleanApiKey = this.cleanValue(apiKey);
    const cleanVoiceId = this.cleanValue(voiceId);
    const cleanModelId = this.cleanValue(modelId);

    this.logger.log(
      `[TTS] ElevenLabs request voice=${cleanVoiceId} model=${cleanModelId} key=${this.maskSecret(cleanApiKey)}`,
    );

    if (!cleanApiKey || !cleanVoiceId || !cleanModelId) {
      throw new BadGatewayException('ElevenLabs profile contains empty apiKey/voiceId/modelId');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${cleanVoiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': cleanApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: cleanModelId,
        }),
      },
    );

    if (!response.ok) {
      const errorMessage = await response.text();
      this.logger.error(
        `[TTS] ElevenLabs failed status=${response.status} body=${errorMessage || response.statusText}`,
      );
      throw new BadGatewayException(
        `ElevenLabs request failed: ${errorMessage || response.statusText}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async uploadToCloudinary(audioBuffer: Buffer, meaningId: number) {
    const folder = this.configService.get<string>('cloudinary.folder');
    const publicId = `meaning-${meaningId}-${Date.now()}`;

    this.logger.log(
      `[TTS] Cloudinary upload start folder=${folder ?? 'missing'} publicId=${publicId} bytes=${audioBuffer.length}`,
    );

    try {
      return await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'video',
            folder,
            public_id: publicId,
            format: 'mp3',
          },
          (error, result) => {
            if (error || !result) {
              this.logger.error(
                `[TTS] Cloudinary callback error publicId=${publicId} error=${(error as Error | undefined)?.message ?? 'unknown'}`,
              );
              reject(error || new Error('Cloudinary upload failed'));
              return;
            }
            resolve(result);
          },
        );

        uploadStream.end(audioBuffer);
      });
    } catch (error) {
      this.logger.error('Cloudinary upload failed', error as Error);
      throw new InternalServerErrorException('Cloudinary upload failed');
    }
  }
}
