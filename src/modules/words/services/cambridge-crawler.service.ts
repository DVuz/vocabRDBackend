import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { PrismaService } from 'src/prisma/prisma.service';

// ─── Constants ────────────────────────────────────────────────────────────────
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
const MIN_MEANINGS_PHASE1 = 3; // nếu Phase 1 < 3 meanings → chạy Phase 2

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

// ─── Types ────────────────────────────────────────────────────────────────────
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

interface ResolvedPage {
  response: Response;
  html: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
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
  const cleaned = cleanText(def);
  if (cleaned.length < 10) return false;
  if (!/[a-zA-Z]/.test(cleaned)) return false;

  const blacklist = [
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

  return !blacklist.some((pattern) => pattern.test(cleaned));
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
  const a = normalizeDef(defA);
  const b = normalizeDef(defB);

  if (a === b) return true;

  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  if (longer.includes(shorter) && shorter.length / longer.length > 0.7) {
    return true;
  }

  const wordsA = a.split(' ').filter((w) => w.length > 3);
  const wordsB = b.split(' ').filter((w) => w.length > 3);
  if (wordsA.length > 3 && wordsB.length > 3) {
    const common = wordsA.filter((w) => wordsB.includes(w));
    if (common.length / Math.min(wordsA.length, wordsB.length) > 0.6) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function looksLikeCambridgeEntryPage(html: string): boolean {
  if (!html || html.length < 200) return false;

  const normalized = html.toLowerCase();
  const hasEntryMarkers =
    /entry-body__el|class="pr dictionary"|class="di-title"|class="headword"|class="hw"/i.test(
      html,
    ) || /def-block|ddef_d|sense-block|pron|headword/i.test(normalized);
  const hasDictionarySignals =
    /dictionary\.cambridge\.org|cambridge dictionary|english meaning/i.test(
      normalized,
    );

  return hasDictionarySignals && hasEntryMarkers;
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class CambridgeCrawlerService {
  private readonly logger = new Logger(CambridgeCrawlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public entry point ─────────────────────────────────────────────────────
  async crawlAndSave(
    searchWord: string,
  ): Promise<{ canonicalWord: string } | null> {
    const normalizedSearch = searchWord.trim().toLowerCase();

    const crawled = await this.crawlWord(normalizedSearch);
    if (!crawled || crawled.meanings.length === 0) {
      this.logger.warn(`"${normalizedSearch}" not found on Cambridge`);
      return null;
    }

    const { meanings: rawMeanings, canonicalWord } = crawled;
    const translatedMeanings = await this.translateAll(rawMeanings);

    await this.saveWord(canonicalWord, translatedMeanings);

    if (canonicalWord !== normalizedSearch) {
      await this.saveAlias(normalizedSearch, canonicalWord);
      this.logger.log(`Alias saved: "${normalizedSearch}" → "${canonicalWord}"`);
    }

    this.logger.log(
      `Saved "${canonicalWord}": ${translatedMeanings.length} meanings`,
    );
    return { canonicalWord };
  }

  // ── Alias ──────────────────────────────────────────────────────────────────
  private async saveAlias(alias: string, canonicalWord: string): Promise<void> {
    if (alias === canonicalWord) return;

    try {
      await this.prisma.wordAlias.upsert({
        where: { alias },
        create: { alias, canonicalWord },
        update: { canonicalWord },
      });
    } catch {
      // Non-critical — ignore duplicate / race errors
    }
  }

  // ── Cambridge crawl ────────────────────────────────────────────────────────
  private async crawlWord(
    word: string,
  ): Promise<{ meanings: RawMeaning[]; canonicalWord: string } | null> {
    const startedAt = Date.now();
    this.logger.log(`[crawlWord:start] word=${word}`);

    const resolvedPage = await this.resolveCambridgeEntryPage(word);
    if (!resolvedPage) {
      this.logger.warn(`[crawlWord:fail] word=${word} reason=no-page-resolved durationMs=${Date.now() - startedAt}`);
      return null;
    }

    const { response, html } = resolvedPage;
    this.logger.log(`[crawlWord:resolved] word=${word} url=${response.url} status=${response.status} durationMs=${Date.now() - startedAt}`);

    const $ = cheerio.load(html);

    if (
      !$('.pr.dictionary, .entry-body, .di-title, .pr.entry-body__el').length
    ) {
      this.logger.warn(`[crawlWord:fail] word=${word} reason=no-dictionary-markup durationMs=${Date.now() - startedAt}`);
      return null;
    }

    // Canonical word: URL response > DOM headword > fallback to search term
    const canonicalWord =
      this.extractCanonicalFromUrl(response.url) ||
      $('.hw.dhw').first().text().trim().toLowerCase() ||
      $('.di-title .hw').first().text().trim().toLowerCase() ||
      $('.headword').first().text().trim().toLowerCase() ||
      word;

    const meaningsByPos: Record<string, RawMeaning[]> = {};
    const seenDefinitions = new Set<string>();

    // ── Phase 1: structured entry-body__el blocks ──────────────────────────
    this.scrapeEntryBlocks($, meaningsByPos, seenDefinitions);

    // ── Phase 2: fallback for phrasal verbs, idioms, rare words ───────────
    // Chỉ chạy khi Phase 1 tìm được ít hơn MIN_MEANINGS_PHASE1 meanings
    const phase1Total = Object.values(meaningsByPos).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

    if (phase1Total < MIN_MEANINGS_PHASE1) {
      this.logger.debug(
        `Phase 1 found ${phase1Total} meanings for "${word}", running Phase 2 fallback`,
      );
      this.scrapePosBodies($, meaningsByPos, seenDefinitions);
    }

    const allMeanings = this.sortAndLimit(meaningsByPos);
    if (allMeanings.length === 0) {
      this.logger.warn(`[crawlWord:fail] word=${word} reason=no-meanings-parsed durationMs=${Date.now() - startedAt}`);
      return null;
    }

    this.logger.log(`[crawlWord:success] word=${word} canonical=${canonicalWord} meanings=${allMeanings.length} durationMs=${Date.now() - startedAt}`);
    return { meanings: allMeanings, canonicalWord };
  }

  // ── Phase 1 scraper ────────────────────────────────────────────────────────
  private scrapeEntryBlocks(
    $: cheerio.CheerioAPI,
    meaningsByPos: Record<string, RawMeaning[]>,
    seenDefinitions: Set<string>,
  ): void {
    $('.pr.entry-body__el').each((_, entry) => {
      const $entry = $(entry);
      const pos = normalizePos(
        $entry.find('.pos, .dpos, .posgram .pos').first().text().trim(),
      );
      if (!pos) return;

      const ukIpa = $entry
        .find('.uk .pron .ipa, .uk.dpron .ipa')
        .first()
        .text()
        .trim();
      const usIpa = $entry
        .find('.us .pron .ipa, .us.dpron .ipa')
        .first()
        .text()
        .trim();
      const ukAudio = fullAudioUrl(
        $entry
          .find(
            '.uk .daud audio source[type="audio/mpeg"], .uk.dpron audio source',
          )
          .first()
          .attr('src'),
      );
      const usAudio = fullAudioUrl(
        $entry
          .find(
            '.us .daud audio source[type="audio/mpeg"], .us.dpron audio source',
          )
          .first()
          .attr('src'),
      );

      if (!meaningsByPos[pos]) meaningsByPos[pos] = [];

      $entry
        .find('.def-block, .ddef_block, .sense-block')
        .each((_, senseBlock) => {
          const meaning = this.parseSenseBlock(
            $,
            senseBlock,
            pos,
            ukIpa,
            usIpa,
            ukAudio,
            usAudio,
            seenDefinitions,
          );
          if (meaning) meaningsByPos[pos].push(meaning);
        });
    });
  }

  // ── Phase 2 fallback scraper ───────────────────────────────────────────────
  private scrapePosBodies(
    $: cheerio.CheerioAPI,
    meaningsByPos: Record<string, RawMeaning[]>,
    seenDefinitions: Set<string>,
  ): void {
    // Global audio/IPA as fallback when pos-body doesn't have its own
    const globalUkIpa = $('.uk .pron .ipa').first().text().trim();
    const globalUsIpa =
      $('.us .pron .ipa').first().text().trim() || globalUkIpa;
    const globalUkAudio = fullAudioUrl(
      $('.uk .daud audio source[type="audio/mpeg"]').first().attr('src'),
    );
    const globalUsAudio = fullAudioUrl(
      $('.us .daud audio source[type="audio/mpeg"]').first().attr('src'),
    );

    $('.pos-body, .pv-body, .idiom-body').each((_, posBody) => {
      const $posBody = $(posBody);

      const rawPos =
        $posBody.prevAll('.pos-header, .pos, .dpos-h').first().text().trim() ||
        $posBody
          .closest('.entry-body__el, .entry, .di-body')
          .find('.pos, .dpos')
          .first()
          .text()
          .trim();

      const pos = normalizePos(rawPos) || 'unknown';

      const ukIpa =
        $posBody.find('.uk .pron .ipa').first().text().trim() || globalUkIpa;
      const usIpa =
        $posBody.find('.us .pron .ipa').first().text().trim() || globalUsIpa;
      const ukAudio =
        fullAudioUrl(
          $posBody
            .find('.uk .daud audio source[type="audio/mpeg"]')
            .first()
            .attr('src'),
        ) || globalUkAudio;
      const usAudio =
        fullAudioUrl(
          $posBody
            .find('.us .daud audio source[type="audio/mpeg"]')
            .first()
            .attr('src'),
        ) || globalUsAudio;

      if (!meaningsByPos[pos]) meaningsByPos[pos] = [];

      $posBody
        .find('.def-block, .ddef_block, .sense-block')
        .each((_, senseBlock) => {
          const meaning = this.parseSenseBlock(
            $,
            senseBlock,
            pos,
            ukIpa,
            usIpa,
            ukAudio,
            usAudio,
            seenDefinitions,
          );
          if (meaning) meaningsByPos[pos].push(meaning);
        });
    });
  }

  // ── Shared sense block parser ──────────────────────────────────────────────
  private parseSenseBlock(
    $: cheerio.CheerioAPI,
    senseBlock: Element,
    pos: string,
    ukIpa: string,
    usIpa: string,
    ukAudio: string,
    usAudio: string,
    seenDefinitions: Set<string>,
  ): RawMeaning | null {
    const $sense = $(senseBlock);

    const rawDefinition = $sense.find('.def, .ddef_d').first().text().trim();
    if (!rawDefinition || !isValidDefinition(rawDefinition)) return null;

    const definition = cleanText(rawDefinition);

    // Dedup check
    for (const seen of seenDefinitions) {
      if (isSimilar(definition, seen)) return null;
    }
    seenDefinitions.add(definition);

    const cefrLevel = $sense
      .find('.epp-xref, .def-info .epp-xref')
      .first()
      .text()
      .trim();

    const examples: string[] = [];
    $sense.find('.examp .eg, .dexamp .deg, .eg').each((_, example) => {
      if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false;
      const text = cleanText($(example).text());
      if (text.length > 10) examples.push(text);
    });

    return { pos, ukIpa, usIpa, ukAudio, usAudio, definition, cefrLevel, examples };
  }

  // ── URL resolution ─────────────────────────────────────────────────────────
  // Thử 3 endpoints theo độ ưu tiên:
  // 1. /search/english/direct/ → Cambridge tự redirect về đúng canonical URL
  // 2. /dictionary/english/    → direct lookup
  // 3. /dictionary/english/check?q= → spelling check fallback
  private async resolveCambridgeEntryPage(
    word: string,
  ): Promise<ResolvedPage | null> {
    const targets = [
      `${CAMBRIDGE_SEARCH_DIRECT_BASE}${encodeURIComponent(word)}`,
      `${CAMBRIDGE_DICTIONARY_BASE}${encodeURIComponent(word)}`,
      `${CAMBRIDGE_CHECK_BASE}${encodeURIComponent(word)}`,
    ];

    for (const target of targets) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        this.logger.debug(`Trying: ${target} (attempt ${attempt}/3)`);
        try {
          const response = await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(25000),
          });

          if (!response.ok) {
            if (attempt < 3) {
              await sleep(800 * attempt);
              continue;
            }
            continue;
          }

          const html = await response.text();
          if (!looksLikeCambridgeEntryPage(html)) {
            if (attempt < 3) {
              await sleep(800 * attempt);
              continue;
            }
            continue;
          }

          return { response, html };
        } catch (error) {
          this.logger.debug(`Failed for ${target}: ${(error as Error).message}`);
          if (attempt < 3) {
            await sleep(800 * attempt);
          }
        }
      }
    }

    return null;
  }

  // Đọc canonical word từ URL response sau khi Cambridge redirect
  // VD: /dictionary/english/run → "run"
  private extractCanonicalFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const marker = '/dictionary/english/';
      const index = parsedUrl.pathname.indexOf(marker);
      if (index < 0) return '';

      const segment = decodeURIComponent(
        parsedUrl.pathname
          .slice(index + marker.length)
          .split('/')[0]
          .trim()
          .toLowerCase(),
      );

      // Bỏ qua nếu là các route đặc biệt, không phải entry word
      if (!segment || ['check', 'search', 'direct'].includes(segment)) {
        return '';
      }

      return segment;
    } catch {
      return '';
    }
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  private sortAndLimit(
    meaningsByPos: Record<string, RawMeaning[]>,
  ): RawMeaning[] {
    const sorted: RawMeaning[] = [];

    // Các POS phổ biến trước theo POS_ORDER
    for (const pos of POS_ORDER) {
      if (meaningsByPos[pos]) sorted.push(...meaningsByPos[pos]);
    }

    // Các POS còn lại (unknown, interjection, article, v.v.)
    for (const pos of Object.keys(meaningsByPos)) {
      if (!POS_ORDER.includes(pos)) sorted.push(...meaningsByPos[pos]);
    }

    return sorted.slice(0, MAX_MEANINGS_PER_WORD);
  }

  // ── Translation ────────────────────────────────────────────────────────────
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

  // ── Persist ────────────────────────────────────────────────────────────────
  private async saveWord(word: string, meanings: RawMeaning[]): Promise<void> {
    await this.prisma.word.upsert({
      where: { word },
      create: { word },
      update: {},
    });

    const wordRow = await this.prisma.word.findUnique({ where: { word } });
    if (!wordRow) return;
    const wordId = wordRow.id;

    // Xác định meanings nào đang được user dùng → không được xóa (locked)
    const existingMeanings = await this.prisma.wordMeaning.findMany({
      where: { wordId },
      select: { id: true },
    });
    const existingIds = existingMeanings.map((m) => m.id);
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

    // Xóa meanings cũ không bị lock
    const idsToDelete = existingIds.filter((id) => !lockedIds.has(id));
    if (idsToDelete.length > 0) {
      await this.prisma.wordMeaning.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    // Insert meanings mới
    await this.prisma.$transaction(
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
      ),
    );
  }
}