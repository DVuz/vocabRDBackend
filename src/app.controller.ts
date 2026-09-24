import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { AppService } from './app.service';

const CAMBRIDGE_AUDIO_HOST = 'dictionary.cambridge.org';
const CAMBRIDGE_AUDIO_PATH_PREFIX = '/media/english/';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('proxy/audio')
  async proxyAudio(@Query('url') url?: string): Promise<StreamableFile> {
    if (!url) {
      throw new HttpException('Missing url query param', HttpStatus.BAD_REQUEST);
    }

    let targetUrl: URL;

    try {
      targetUrl = new URL(url);
    } catch {
      throw new HttpException('Invalid url', HttpStatus.BAD_REQUEST);
    }

    if (
      targetUrl.protocol !== 'https:' ||
      targetUrl.hostname !== CAMBRIDGE_AUDIO_HOST ||
      !targetUrl.pathname.startsWith(CAMBRIDGE_AUDIO_PATH_PREFIX)
    ) {
      throw new HttpException('URL is not allowed', HttpStatus.BAD_REQUEST);
    }

    const response = await fetch(targetUrl);

    if (!response.ok || !response.body) {
      throw new HttpException(
        'Unable to proxy Cambridge audio',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return new StreamableFile(buffer, {
      type: response.headers.get('content-type') ?? 'audio/mpeg',
      disposition: `inline; filename="${targetUrl.pathname.split('/').pop() ?? 'audio.mp3'}"`,
    });
  }
}
