import { registerAs } from '@nestjs/config';

export default registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  ttsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts',
  ttsVoice: process.env.GEMINI_TTS_VOICE ?? 'Kore',
  enabled: process.env.GEMINI_ENABLED !== 'false',
}));
