// src/config/elevenlabs.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('elevenlabs', () => ({
  apiKey: process.env.ELEVENLABS_API_KEY,
  voiceId: process.env.ELEVENLABS_VOICE_ID,
  modelId: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2',
}));