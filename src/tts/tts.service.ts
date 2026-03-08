import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class TtsService {
  async synthesize(text: string): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

    if (!apiKey) {
      throw new InternalServerErrorException('ELEVENLABS_API_KEY is not configured');
    }

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.substring(0, 500),
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new InternalServerErrorException(
        `ElevenLabs error ${resp.status}: ${err.slice(0, 200)}`
      );
    }

    const buffer = await resp.arrayBuffer();
    return Buffer.from(buffer);
  }
}
