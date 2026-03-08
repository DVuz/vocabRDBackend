import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { TtsService } from './tts.service';

@Controller('tts')
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  @Get('health')
  health() {
    const configured = !!process.env.ELEVENLABS_API_KEY;
    return {
      status: configured ? 'ok' : 'missing_key',
      voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
    };
  }

  @Post('speak')
  @HttpCode(200)
  async speak(@Body('text') text: string, @Res() res: Response) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const audio = await this.ttsService.synthesize(text.trim());
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length,
      'Cache-Control': 'no-store',
    });
    res.send(audio);
  }
}
