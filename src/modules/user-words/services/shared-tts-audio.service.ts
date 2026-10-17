import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GoogleGenAI } from '@google/genai';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';

interface InlineAudio {
  data?: string;
  mimeType?: string;
}

interface GeminiAudioResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: InlineAudio }>;
    };
  }>;
}

@Injectable()
export class SharedTtsAudioService {
  private readonly logger = new Logger(SharedTtsAudioService.name);
  private readonly s3: S3Client | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    this.s3 =
      endpoint && accessKeyId && secretAccessKey
        ? new S3Client({
            region: process.env.S3_REGION ?? 'ap-southeast-1',
            endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;

    if (!this.s3) {
      this.logger.warn(
        'Supabase Storage is not configured; Gemini TTS audio will be skipped',
      );
    }
  }

  async ensureWordPronunciation(params: {
    wordId: number;
    word: string;
    ukAudioUrl: string | null;
    usAudioUrl: string | null;
  }): Promise<{ uk: string | null; us: string | null }> {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const enabled = this.configService.get<boolean>('gemini.enabled') ?? false;
    if (!enabled || !apiKey || !this.s3) {
      this.logger.warn(
        `[TTS] skipped word=${params.word}: Gemini or Supabase Storage is not configured`,
      );
      return { uk: params.ukAudioUrl, us: params.usAudioUrl };
    }

    let ukAudioUrl = params.ukAudioUrl;
    let usAudioUrl = params.usAudioUrl;
    try {
      if (!ukAudioUrl) {
        const audio = await this.generateAudio(
          params.word,
          apiKey,
          'British English',
        );
        ukAudioUrl = await this.uploadToSupabase(
          audio,
          this.buildStorageKey('uk', params.word, params.wordId),
        );
      }
      if (!usAudioUrl) {
        const audio = await this.generateAudio(
          params.word,
          apiKey,
          'American English',
        );
        usAudioUrl = await this.uploadToSupabase(
          audio,
          this.buildStorageKey('us', params.word, params.wordId),
        );
      }

      await this.prisma.word.update({
        where: { id: params.wordId },
        data: { ukAudioUrl, usAudioUrl },
      });
      return { uk: ukAudioUrl, us: usAudioUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[TTS] Gemini pronunciation failed word=${params.word}: ${message}`,
      );
      throw new BadGatewayException('Gemini TTS audio generation failed');
    }
  }

  private async generateAudio(
    word: string,
    apiKey: string,
    accent: string,
  ): Promise<Buffer> {
    const ai = new GoogleGenAI({ apiKey });
    const model =
      this.configService.get<string>('gemini.ttsModel') ??
      'gemini-2.5-flash-preview-tts';
    const voice = this.configService.get<string>('gemini.ttsVoice') ?? 'Kore';

    const response = (await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Pronounce only this English word: ${word}. Use a natural ${accent} accent. Do not say anything else.`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    })) as unknown as GeminiAudioResponse;

    const inlineData = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    )?.inlineData;
    if (!inlineData?.data) {
      throw new Error('Gemini TTS returned no audio data');
    }

    const pcm = Buffer.from(inlineData.data, 'base64');
    return this.toWav(pcm, inlineData.mimeType);
  }

  private async uploadToSupabase(audio: Buffer, key: string): Promise<string> {
    if (!this.s3) {
      throw new Error('Supabase Storage is not configured');
    }

    await this.s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET ?? 'vocab',
        Key: key,
        Body: audio,
        ContentType: 'audio/wav',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return `${this.publicBaseUrl}/${key}`;
  }

  private buildStorageKey(
    accent: string,
    word: string,
    wordId: number,
  ): string {
    const slug =
      word
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-') || `word-${wordId}`;
    const letter = /^[a-z]/.test(slug) ? slug[0] : '0-9';
    return `pronunciation/${accent}/${letter}/${slug}-${wordId}.wav`;
  }

  private get publicBaseUrl(): string {
    const configured = process.env.PUBLIC_BASE_URL;
    if (configured) return configured.replace(/\/$/, '');

    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) {
      throw new Error('PUBLIC_BASE_URL or S3_ENDPOINT is required');
    }

    const projectRef = new URL(endpoint).hostname.split('.')[0];
    const bucket = process.env.S3_BUCKET ?? 'vocab';
    return `https://${projectRef}.supabase.co/storage/v1/object/public/${bucket}`;
  }

  private toWav(pcm: Buffer, mimeType = ''): Buffer {
    const params = new URLSearchParams(mimeType.split(';').slice(1).join('&'));
    const sampleRate = Number(params.get('rate') ?? 24000);
    const bitsPerSample = 16;
    const channels = 1;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);

    return Buffer.concat([header, pcm]);
  }
}
