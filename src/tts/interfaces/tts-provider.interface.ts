export interface ITtsProvider {
  synthesize(text: string): Promise<Buffer>;
}

export const TTS_PROVIDER = 'TTS_PROVIDER';
