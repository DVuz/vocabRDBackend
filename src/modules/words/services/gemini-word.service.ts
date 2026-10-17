import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { SharedTtsAudioService } from 'src/modules/user-words/services/shared-tts-audio.service';

interface GeminiMeaning {
  definition: string;
  vnDefinition: string;
  partOfSpeech: string | null;
  cefrLevel: string | null;
  examples: string[];
}

interface GeminiWord {
  word: string;
  ukIpa: string | null;
  usIpa: string | null;
  meanings: GeminiMeaning[];
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

@Injectable()
export class GeminiWordService {
  private readonly logger = new Logger(GeminiWordService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sharedTtsAudioService: SharedTtsAudioService,
  ) {}

  async generateAndSave(searchWord: string): Promise<void> {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const enabled = this.configService.get<boolean>('gemini.enabled') ?? false;
    const model =
      this.configService.get<string>('gemini.model') ?? 'gemini-2.5-flash';

    if (!enabled || !apiKey) {
      this.logger.debug(
        'Gemini fallback is disabled or GEMINI_API_KEY is missing',
      );
      return;
    }

    try {
      const generated = await this.generate(searchWord, apiKey, model);
      if (!generated) {
        this.logger.warn(`[gemini] no valid result for "${searchWord}"`);
        return;
      }

      await this.save(searchWord, generated);
      await this.generateMeaningAudio(generated.word);
      this.logger.log(
        `[gemini] saved word="${generated.word}" meanings=${generated.meanings.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[gemini] lookup failed for "${searchWord}": ${message}`,
      );
    }
  }

  private async generateMeaningAudio(word: string): Promise<void> {
    const wordRecord = await this.prisma.word.findUnique({
      where: { word },
      select: {
        id: true,
        word: true,
        ukAudioUrl: true,
        usAudioUrl: true,
      },
    });
    if (!wordRecord) return;

    try {
      await this.sharedTtsAudioService.ensureWordPronunciation({
        wordId: wordRecord.id,
        word: wordRecord.word,
        ukAudioUrl: wordRecord.ukAudioUrl,
        usAudioUrl: wordRecord.usAudioUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[gemini] pronunciation failed word=${word}: ${message}`,
      );
    }
  }

  private async generate(
    searchWord: string,
    apiKey: string,
    model: string,
  ): Promise<GeminiWord | null> {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    const prompt = [
      'You are an English dictionary data provider.',
      `Look up the English word or inflected form "${searchWord}".`,
      'Return JSON only. Do not use Markdown and do not invent unrelated words.',
      'If it is not an English word, return {"word":"","meanings":[]}.',
      'The JSON must have this exact shape:',
      '{"word":"canonical lowercase headword","ukIpa":string|null,"usIpa":string|null,"meanings":[{"definition":"English definition","vnDefinition":"Vietnamese translation","partOfSpeech":string|null,"cefrLevel":"A1|A2|B1|B2|C1|C2|null","examples":["English example"]}]}',
      'Use at most 5 meanings and 2 examples per meaning.',
    ].join('\n');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as GeminiGenerateResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn('[gemini] response was not valid JSON');
      return null;
    }

    return this.validateResult(parsed);
  }

  private validateResult(value: unknown): GeminiWord | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    const word =
      typeof candidate.word === 'string'
        ? candidate.word.trim().toLowerCase()
        : '';
    const meanings = Array.isArray(candidate.meanings)
      ? candidate.meanings
      : [];

    if (!word || !/^[a-z][a-z' -]{0,99}$/.test(word) || meanings.length === 0) {
      return null;
    }

    const normalizedMeanings = meanings
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object',
      )
      .map((item) => ({
        definition:
          typeof item.definition === 'string' ? item.definition.trim() : '',
        vnDefinition:
          typeof item.vnDefinition === 'string' ? item.vnDefinition.trim() : '',
        partOfSpeech:
          typeof item.partOfSpeech === 'string'
            ? item.partOfSpeech.trim()
            : null,
        cefrLevel:
          typeof item.cefrLevel === 'string' ? item.cefrLevel.trim() : null,
        examples: Array.isArray(item.examples)
          ? item.examples
              .filter(
                (example): example is string => typeof example === 'string',
              )
              .slice(0, 2)
          : [],
      }))
      .filter((item) => item.definition && item.vnDefinition)
      .slice(0, 5);

    if (normalizedMeanings.length === 0) return null;

    return {
      word,
      ukIpa:
        typeof candidate.ukIpa === 'string' ? candidate.ukIpa.trim() : null,
      usIpa:
        typeof candidate.usIpa === 'string' ? candidate.usIpa.trim() : null,
      meanings: normalizedMeanings,
    };
  }

  private async save(searchWord: string, generated: GeminiWord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const wordRow = await tx.word.upsert({
        where: { word: generated.word },
        create: {
          word: generated.word,
          ukIpa: generated.ukIpa,
          usIpa: generated.usIpa,
        },
        update: {
          ukIpa: generated.ukIpa || undefined,
          usIpa: generated.usIpa || undefined,
        },
      });

      const meaningCount = await tx.wordMeaning.count({
        where: { wordId: wordRow.id },
      });
      if (meaningCount === 0) {
        await tx.wordMeaning.createMany({
          data: generated.meanings.map((meaning) => ({
            wordId: wordRow.id,
            definition: meaning.definition,
            vnDefinition: meaning.vnDefinition,
            partOfSpeech: meaning.partOfSpeech,
            cefrLevel: meaning.cefrLevel,
            examples: meaning.examples,
          })),
        });
      }

      if (searchWord !== generated.word) {
        await tx.wordAlias.upsert({
          where: { alias: searchWord },
          create: { alias: searchWord, canonicalWord: generated.word },
          update: { canonicalWord: generated.word },
        });
      }
    });
  }
}
