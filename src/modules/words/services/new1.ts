import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import { PrismaService } from 'src/prisma/prisma.service';

const CAMBRIDGE_DICTIONARY_BASE =
  'https://dictionary.cambridge.org/dictionary/english/';
const CAMBRIDGE_SEARCH_DIRECT_BASE =
  'https://dictionary.cambridge.org/search/english/direct/?q=';
const CAMBRIDGE_CHECK_BASE =
  'https://dictionary.cambridge.org/dictionary/english/check?q=';
const TRANSLATE_API =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=';
const MAX_EXAMPLES_PER_SENSE = 3;
const MAX_MEANINGS_PER_WORD = 15;
const TRANSLATE_DELAY_MS = 300;

const POS_ORDER = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'modal verb',
  'number',
  'exclamation',
  'prefix',
  'suffix',
  'abbreviation',
];

interface RawMeaning {
  pos: string;
  ukIpa: string;
  usIpa: string;
  ukAudio: string;
  usAudio: string;
  definition: string;
  cefrLevel: string;
  examples: string[];
  vnDefinition?: string;
}

function cleanText(text: string): string {
  return text
    .replace(/→\s*/g, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-•→►]\s*/g, '')
    .replace(/^\s*\d+\.\s*/g, '')
    .replace(/\s*\|\s*/g, ' ')
    .trim();
}

function isValidDefinition(def: string): boolean {
  const c = cleanText(def);
  if (c.length < 10) return false;
  if (!/[a-zA-Z]/.test(c)) return false;
  const bad = [
    /^memory address$/i,
    /^→\s*$/,
    /^[\s\n\r\t]*$/,
    /^[\d\s\-•→►]*$/,
    /^see also/i,
    /^compare/i,
    /^opposite/i,
    /^related/i,
    /^idioms?:/i,
    /^phrasal verbs?:/i,
  ];

  return !bad.some((pattern) => pattern.test(c));
}

function normalizePos(raw: string): string {
  const cleaned = raw
    .replace(/[^\w\s]/g, '')
    .trim()
    .toLowerCase();
  const mapping: Record<string, string> = {
    n: 'noun',
    v: 'verb',
    adj: 'adjective',
    adv: 'adverb',
    prep: 'preposition',
    conj: 'conjunction',
    pron: 'pronoun',
    interj: 'interjection',
    det: 'determiner',
    art: 'article',
    'modal verb': 'modal verb',
    exclamation: 'exclamation',
    number: 'number',
    prefix: 'prefix',
    suffix: 'suffix',
    abbreviation: 'abbreviation',
  };

  return mapping[cleaned] ?? cleaned;
}

function fullAudioUrl(src: string | undefined): string {
  if (!src) return '';
  return src.startsWith('http')
    ? src
    : `https://dictionary.cambridge.org${src}`;
}

function normalizeDef(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(defA: string, defB: string): boolean {
  const normalizedA = normalizeDef(defA);
  const normalizedB = normalizeDef(defB);
  if (normalizedA === normalizedB) return true;

  const [longer, shorter] =
    normalizedA.length > normalizedB.length
      ? [normalizedA, normalizedB]
      : [normalizedB, normalizedA];

  if (longer.includes(shorter) && shorter.length / longer.length > 0.7) {
    return true;
  }

  const wordsA = normalizedA.split(' ').filter((word) => word.length > 3);
  const wordsB = normalizedB.split(' ').filter((word) => word.length > 3);
  if (wordsA.length > 3 && wordsB.length > 3) {
    const common = wordsA.filter((word) => wordsB.includes(word));
    if (common.length / Math.min(wordsA.length, wordsB.length) > 0.6) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class CambridgeCrawlerService {
  private readonly logger = new Logger(CambridgeCrawlerService.name);
  private readonly dbSchema = 'vocabnew';

  constructor(private readonly prisma: PrismaService) {}

  async crawlAndSave(
    searchWord: string,
  ): Promise<{ canonicalWord: string } | null> {
    const normalizedSearch = searchWord.trim().toLowerCase();
    const crawled = await this.crawlWord(normalizedSearch);
    if (!crawled || crawled.meanings.length === 0) return null;

    const canonicalWord = crawled.canonicalWord;
    const translatedMeanings = await this.translateAll(crawled.meanings);

    await this.saveWord(canonicalWord, translatedMeanings);

    if (canonicalWord !== normalizedSearch) {
      await this.saveAlias(normalizedSearch, canonicalWord);
      this.logger.log(`Alias saved: ${normalizedSearch} -> ${canonicalWord}`);
    }

    return { canonicalWord };
  }

  private async saveAlias(alias: string, canonicalWord: string): Promise<void> {
    if (alias === canonicalWord) return;

    await this.prisma.wordAlias.upsert({
      where: { alias },
      create: { alias, canonicalWord },
      update: { canonicalWord },
    });
  }

  private async crawlWord(
    word: string,
  ): Promise<{ meanings: RawMeaning[]; canonicalWord: string } | null> {
    const resolvedPage = await this.resolveCambridgeEntryPage(word);
    if (!resolvedPage) return null;

    const { response, html } = resolvedPage;
    const $ = cheerio.load(html);
    if (
      !$('.pr.dictionary, .entry-body, .di-title, .pr.entry-body__el').length
    ) {
      return null;
    }

    const responseUrlCanonical = this.extractCanonicalFromUrl(response.url);
    const canonicalWord =
      $('.hw.dhw').first().text().trim().toLowerCase() ||
      $('.di-title .hw').first().text().trim().toLowerCase() ||
      $('.headword').first().text().trim().toLowerCase() ||
      responseUrlCanonical ||
      word;

    const meaningsByPos: Record<string, RawMeaning[]> = {};
    const seenDefinitions = new Set<string>();

    $('.pr.entry-body__el').each((_, entry) => {
      const entryNode = $(entry);
      const partOfSpeech = normalizePos(
        entryNode.find('.pos, .dpos, .posgram .pos').first().text().trim(),
      );
      if (!partOfSpeech) return;

      const ukIpa = entryNode
        .find('.uk .pron .ipa, .uk.dpron .ipa')
        .first()
        .text()
        .trim();
      const usIpa = entryNode
        .find('.us .pron .ipa, .us.dpron .ipa')
        .first()
        .text()
        .trim();
      const ukAudio = fullAudioUrl(
        entryNode
          .find(
            '.uk .daud audio source[type="audio/mpeg"], .uk.dpron audio source',
          )
          .first()
          .attr('src'),
      );
      const usAudio = fullAudioUrl(
        entryNode
          .find(
            '.us .daud audio source[type="audio/mpeg"], .us.dpron audio source',
          )
          .first()
          .attr('src'),
      );

      if (!meaningsByPos[partOfSpeech]) {
        meaningsByPos[partOfSpeech] = [];
      }

      entryNode
        .find('.def-block, .ddef_block, .sense-block')
        .each((_, senseBlock) => {
          const senseNode = $(senseBlock);
          const rawDefinition = senseNode
            .find('.def, .ddef_d')
            .first()
            .text()
            .trim();
          if (!rawDefinition || !isValidDefinition(rawDefinition)) return;

          const definition = cleanText(rawDefinition);
          for (const seen of seenDefinitions) {
            if (isSimilar(definition, seen)) return;
          }
          seenDefinitions.add(definition);

          const cefrLevel = senseNode
            .find('.epp-xref, .def-info .epp-xref')
            .first()
            .text()
            .trim();

          const examples: string[] = [];
          senseNode.find('.examp .eg, .dexamp .deg, .eg').each((_, example) => {
            if (examples.length >= MAX_EXAMPLES_PER_SENSE) {
              return false;
            }

            const text = cleanText($(example).text());
            if (text.length > 10) {
              examples.push(text);
            }

            return;
          });

          meaningsByPos[partOfSpeech].push({
            pos: partOfSpeech,
            ukIpa,
            usIpa,
            ukAudio,
            usAudio,
            definition,
            cefrLevel,
            examples,
          });
        });
    });

    const allMeanings = this.sortMeanings(meaningsByPos).slice(
      0,
      MAX_MEANINGS_PER_WORD,
    );
    if (allMeanings.length === 0) return null;

    return { meanings: allMeanings, canonicalWord };
  }

  private async resolveCambridgeEntryPage(
    word: string,
  ): Promise<{ response: Response; html: string } | null> {
    const targets = [
      `${CAMBRIDGE_SEARCH_DIRECT_BASE}${encodeURIComponent(word)}`,
      `${CAMBRIDGE_DICTIONARY_BASE}${encodeURIComponent(word)}`,
      `${CAMBRIDGE_CHECK_BASE}${encodeURIComponent(word)}`,
    ];

    for (const target of targets) {
      this.logger.log(`Crawling Cambridge for word: ${target}`);
      try {
        const response = await fetch(target, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(25000),
        });

        if (!response.ok) {
          continue;
        }

        const html = await response.text();
        const hasDictionaryMarkup =
          /entry-body__el|class="pr dictionary"|class="di-title"/i.test(html);
        if (!hasDictionaryMarkup) {
          continue;
        }

        return { response, html };
      } catch {
        continue;
      }
    }

    return null;
  }

  private extractCanonicalFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const marker = '/dictionary/english/';
      const index = parsedUrl.pathname.indexOf(marker);
      if (index < 0) return '';

      const pathPart = parsedUrl.pathname.slice(index + marker.length);
      const segment = decodeURIComponent(
        pathPart.split('/')[0].trim().toLowerCase(),
      );

      if (!segment || ['check', 'search', 'direct'].includes(segment)) {
        return '';
      }

      return segment;
    } catch {
      return '';
    }
  }

  private sortMeanings(
    meaningsByPos: Record<string, RawMeaning[]>,
  ): RawMeaning[] {
    const sorted: RawMeaning[] = [];

    POS_ORDER.forEach((partOfSpeech) => {
      if (meaningsByPos[partOfSpeech]) {
        sorted.push(...meaningsByPos[partOfSpeech]);
      }
    });

    Object.keys(meaningsByPos).forEach((partOfSpeech) => {
      if (!POS_ORDER.includes(partOfSpeech)) {
        sorted.push(...meaningsByPos[partOfSpeech]);
      }
    });

    return sorted;
  }

  private async translateToVi(text: string): Promise<string> {
    try {
      const url = TRANSLATE_API + encodeURIComponent(text);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) return '';
      const raw = await response.text();
      const parsed = JSON.parse(raw);
      return parsed?.[0]?.[0]?.[0] ?? '';
    } catch {
      return '';
    }
  }

  private async translateAll(meanings: RawMeaning[]): Promise<RawMeaning[]> {
    const output: RawMeaning[] = [];

    for (const meaning of meanings) {
      const vnDefinition = await this.translateToVi(meaning.definition);
      output.push({ ...meaning, vnDefinition });
      await sleep(TRANSLATE_DELAY_MS);
    }

    return output;
  }

  private async saveWord(word: string, meanings: RawMeaning[]): Promise<void> {
    await this.upsertWordWithRecovery(word);

    const wordRow = await this.prisma.word.findUnique({ where: { word } });
    if (!wordRow) return;
    const wordId = wordRow.id;

    const existingMeanings = await this.prisma.wordMeaning.findMany({
      where: { wordId },
      select: { id: true },
    });
    const existingIds = existingMeanings.map((meaning) => meaning.id);

    const lockedIds = new Set<number>();
    if (existingIds.length > 0) {
      const [userWords, wordListItems, reviewSessionItems] = await Promise.all([
        this.prisma.userWord.findMany({
          where: { wordMeaningId: { in: existingIds } },
          select: { wordMeaningId: true },
        }),
        this.prisma.wordListItem.findMany({
          where: { wordMeaningId: { in: existingIds } },
          select: { wordMeaningId: true },
        }),
        this.prisma.reviewSessionItem.findMany({
          where: { userWord: { wordMeaningId: { in: existingIds } } },
          select: { userWord: { select: { wordMeaningId: true } } },
        }),
      ]);

      userWords.forEach((row) => lockedIds.add(row.wordMeaningId));
      wordListItems.forEach((row) => lockedIds.add(row.wordMeaningId));
      reviewSessionItems.forEach((row) =>
        lockedIds.add(row.userWord.wordMeaningId),
      );
    }

    const idsToDelete = existingIds.filter((id) => !lockedIds.has(id));
    if (idsToDelete.length > 0) {
      await this.prisma.wordMeaning.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    await this.insertWordMeaningsWithRecovery(wordId, meanings);
  }

  private async upsertWordWithRecovery(word: string): Promise<void> {
    try {
      await this.prisma.word.upsert({
        where: { word },
        create: { word },
        update: {},
      });
      return;
    } catch (error) {
      if (!this.isIdUniqueConflict(error)) {
        throw error;
      }
    }

    this.logger.warn(
      'Detected words.id sequence mismatch. Resetting sequence and retrying upsert.',
    );
    await this.resetTableIdSequence('words');

    await this.prisma.word.upsert({
      where: { word },
      create: { word },
      update: {},
    });
  }

  private async insertWordMeaningsWithRecovery(
    wordId: number,
    meanings: RawMeaning[],
  ): Promise<void> {
    const createOperations = () =>
      meanings.map((meaning) =>
        this.prisma.wordMeaning.create({
          data: {
            wordId,
            definition: meaning.definition,
            vnDefinition: meaning.vnDefinition ?? '',
            partOfSpeech: meaning.pos || null,
            examples: meaning.examples ?? [],
            cefrLevel: meaning.cefrLevel || null,
            ukIpa: meaning.ukIpa || null,
            usIpa: meaning.usIpa || null,
            ukAudioUrl: meaning.ukAudio || null,
            usAudioUrl: meaning.usAudio || null,
          },
        }),
      );

    try {
      await this.prisma.$transaction(createOperations());
      return;
    } catch (error) {
      if (!this.isIdUniqueConflict(error)) {
        throw error;
      }
    }

    this.logger.warn(
      'Detected word_meanings.id sequence mismatch. Resetting sequence and retrying insert.',
    );
    await this.resetTableIdSequence('word_meanings');

    await this.prisma.$transaction(createOperations());
  }

  private isIdUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    if (!target) {
      return true;
    }

    if (Array.isArray(target)) {
      const lowered = target.map((value) => String(value).toLowerCase());
      if (lowered.includes('id')) return true;
      return lowered.some((value) => value.includes('pkey'));
    }

    if (typeof target === 'string') {
      const lowered = target.toLowerCase();
      return lowered.includes('id') || lowered.includes('pkey');
    }

    return false;
  }

  private async resetTableIdSequence(tableName: string): Promise<void> {
    const qualifiedTable = `${this.dbSchema}.${tableName}`;
    await this.prisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('${qualifiedTable}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${qualifiedTable}), 0) + 1,
        false
      )
    `);
  }
}
