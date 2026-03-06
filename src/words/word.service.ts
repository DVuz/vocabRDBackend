import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CrawlerService } from './crawler.service';

@Injectable()
export class WordService {
  private readonly logger = new Logger(WordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: CrawlerService
  ) {}

  /**
   * Get a Word with all its meanings (like Cambridge dictionary)
   */
  async getWordWithMeanings(wordString: string) {
    const w = wordString.toLowerCase().trim();

    // 1. Check alias table first — covers irregular forms (went→go, was→be, etc.)
    //    that the rule-based lemmatizer can't handle, cached from prior Cambridge resolves.
    const alias = await this.prisma.wordAlias.findUnique({ where: { alias: w } });
    if (alias) {
      const aliasResult = await this.prisma.word.findFirst({
        where: { word: { equals: alias.canonicalWord, mode: 'insensitive' } },
        include: { wordMeanings: true },
      });
      if (aliasResult && aliasResult.wordMeanings.length > 0) {
        this.logger.log(`"${w}" resolved via alias table → "${alias.canonicalWord}"`);
        return {
          id: aliasResult.id,
          word: aliasResult.word,
          meanings: aliasResult.wordMeanings.map(m => ({
            id: m.id,
            partOfSpeech: m.partOfSpeech,
            cefrLevel: m.cefrLevel,
            definition: m.definition,
            vnDefinition: m.vnDefinition,
            examples: m.examples ?? [],
            ipa: { uk: m.ukIpa, us: m.usIpa },
            audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
          })),
        };
      }
    }

    // 2. Rule-based lemmatizer for regular inflections (sizes→size, renovated→renovate, etc.)
    const lemma = this.guessLemma(w);
    if (lemma !== w) {
      const lemmaResult = await this.prisma.word.findFirst({
        where: { word: { equals: lemma, mode: 'insensitive' } },
        include: { wordMeanings: true },
      });
      if (lemmaResult && lemmaResult.wordMeanings.length > 0) {
        this.logger.log(`"${w}" resolved to lemma "${lemma}" from DB`);
        return {
          id: lemmaResult.id,
          word: lemmaResult.word,
          meanings: lemmaResult.wordMeanings.map(m => ({
            id: m.id,
            partOfSpeech: m.partOfSpeech,
            cefrLevel: m.cefrLevel,
            definition: m.definition,
            vnDefinition: m.vnDefinition,
            examples: m.examples ?? [],
            ipa: { uk: m.ukIpa, us: m.usIpa },
            audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
          })),
        };
      }
    }

    // 3. Direct DB lookup (exact match — canonical words stored by crawler)
    const result = await this.prisma.word.findFirst({
      where: { word: { equals: w, mode: 'insensitive' } },
      include: { wordMeanings: true },
    });

    if (result) {
      return {
        id: result.id,
        word: result.word,
        meanings: result.wordMeanings.map(m => ({
          id: m.id,
          partOfSpeech: m.partOfSpeech,
          cefrLevel: m.cefrLevel,
          definition: m.definition,
          vnDefinition: m.vnDefinition,
          examples: m.examples ?? [],
          ipa: { uk: m.ukIpa, us: m.usIpa },
          audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
        })),
      };
    }

    // 4. Not in DB — crawl from Cambridge (Cambridge will resolve canonical form
    //    and the crawler will auto-save the alias for next time)
    this.logger.log(`"${w}" not in DB, attempting crawl...`);
    const crawled = await this.crawler.crawlAndSave(w);
    if (crawled) {
      return { id: crawled.id, word: crawled.word, meanings: crawled.meanings };
    }

    throw new NotFoundException(`Word '${wordString}' not found`);
  }

  /**
   * Simple rule-based lemmatizer to catch common English inflections.
   * Returns the guessed base form, or the original word if no rule matches.
   * Cambridge handles the authoritative normalization during crawling.
   */
  private guessLemma(word: string): string {
    const w = word.toLowerCase().trim();

    // Irregular plurals
    const irregulars: Record<string, string> = {
      children: 'child',
      men: 'man',
      women: 'woman',
      teeth: 'tooth',
      feet: 'foot',
      mice: 'mouse',
      geese: 'goose',
      oxen: 'ox',
      criteria: 'criterion',
      phenomena: 'phenomenon',
      cacti: 'cactus',
    };
    if (irregulars[w]) return irregulars[w];

    // -ies → -y  (e.g. dialects → not applicable; bodies → body)
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';

    // -ves → -f / -fe  (e.g. knives → knife)
    if (w.endsWith('ves') && w.length > 4) {
      const stem = w.slice(0, -3);
      return stem + 'fe'; // try "knife" style; Cambridge will correct
    }

    // -sses / -xes / -zes / -ches / -shes → strip -es
    if (/(?:ss|x|z|ch|sh)es$/.test(w) && w.length > 4) return w.slice(0, -2);

    // -s (plain plural) but not -ss, -us, -ss  (dialects → dialect)
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) {
      return w.slice(0, -1);
    }

    // Verb forms: -ing
    if (w.endsWith('ing') && w.length > 5) {
      // running → run (doubled consonant)
      const stem = w.slice(0, -3);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        return stem.slice(0, -1);
      }
      // making → make
      return stem + 'e';
    }

    // Verb forms: -ed
    if (w.endsWith('ed') && w.length > 4) {
      const stem = w.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        return stem.slice(0, -1); // stopped → stop
      }
      if (w.endsWith('ied')) return w.slice(0, -3) + 'y'; // tried → try
      return stem + 'e'; // baked → bake (Cambridge will correct)
    }

    return w;
  }

  /**
   * Get a single WordMeaning by its id
   */
  async findMeaningById(id: number) {
    const meaning = await this.prisma.wordMeaning.findUnique({
      where: { id },
      include: { word: true },
    });

    if (!meaning) {
      throw new NotFoundException(`WordMeaning with id ${id} not found`);
    }

    return {
      meaningId: meaning.id,
      wordId: meaning.wordId,
      word: meaning.word.word,
      partOfSpeech: meaning.partOfSpeech,
      cefrLevel: meaning.cefrLevel,
      definition: meaning.definition,
      vnDefinition: meaning.vnDefinition,
      examples: meaning.examples ?? [],
      ipa: {
        uk: meaning.ukIpa,
        us: meaning.usIpa,
      },
      audio: {
        uk: meaning.ukAudioUrl,
        us: meaning.usAudioUrl,
      },
      createdAt: meaning.createdAt,
    };
  }
}
