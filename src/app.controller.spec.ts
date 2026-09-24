import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('proxyAudio', () => {
    it('should return a streamable file for an allowed Cambridge audio url', async () => {
      const fetchSpy = jest.spyOn(globalThis as never, 'fetch').mockResolvedValue({
        ok: true,
        body: new ReadableStream(),
        arrayBuffer: async () => new TextEncoder().encode('audio-bytes').buffer,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
      } as Response);

      const result = await appController.proxyAudio(
        'https://dictionary.cambridge.org/media/english/us_pron/b/boi/boil_/boil.mp3',
      );

      expect(result).toBeInstanceOf(StreamableFile);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(URL),
      );
      expect((fetchSpy.mock.calls[0]?.[0] as URL).toString()).toBe(
        'https://dictionary.cambridge.org/media/english/us_pron/b/boi/boil_/boil.mp3',
      );

      fetchSpy.mockRestore();
    });

    it('should reject missing url', async () => {
      await expect(appController.proxyAudio()).rejects.toThrow('Missing url query param');
    });

    it('should reject non-cambridge urls', async () => {
      await expect(
        appController.proxyAudio('https://example.com/audio.mp3'),
      ).rejects.toThrow('URL is not allowed');
    });
  });
});
