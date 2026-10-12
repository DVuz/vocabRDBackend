// src/config/elevenlabs.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('elevenlabs', () => ({
  modelId: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2',
}));