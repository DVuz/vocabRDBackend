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

interface ScrapperApiResponse {
  canonicalWord?: string;
  html?: string;
  data?: unknown;
  meanings?: unknown;
  wordMeanings?: unknown;
  word?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => cleanText(item))
      .filter((item) => item.length > 0)
      .slice(0, MAX_EXAMPLES_PER_SENSE);
  }

  if (typeof value === 'string') {
    const cleaned = cleanText(value);
    return cleaned ? [cleaned] : [];
  }

  return [];
}

function normalizeApiMeaning(value: unknown): RawMeaning | null {
  if (!isRecord(value)) return null;

  const definition =
    typeof value.definition === 'string'
      ? value.definition
      : typeof value.meaning === 'string'
        ? value.meaning
        : typeof value.meaningText === 'string'
          ? value.meaningText
          : '';

  if (!definition) return null;

  return {
    pos: normalizePos(
      typeof value.pos === 'string'
        ? value.pos
        : typeof value.partOfSpeech === 'string'
          ? value.partOfSpeech
          : 'unknown',
    ),
    ukIpa: typeof value.ukIpa === 'string' ? value.ukIpa : '',
    usIpa: typeof value.usIpa === 'string' ? value.usIpa : '',
    ukAudio: typeof value.ukAudio === 'string' ? value.ukAudio : '',
    usAudio: typeof value.usAudio === 'string' ? value.usAudio : '',
    definition,
    cefrLevel: typeof value.cefrLevel === 'string' ? value.cefrLevel : '',
    examples: toStringArray(value.examples),
    vnDefinition:
      typeof value.vnDefinition === 'string' ? value.vnDefinition : undefined,
  };
}

function normalizeApiMeanings(value: unknown): RawMeaning[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeApiMeaning(item))
    .filter((item): item is RawMeaning => item !== null);
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
      const fallback = await this.tryScrapperApiFallback(word);
      if (fallback) {
        this.logger.log(`[crawlWord:fallback] word=${word} source=scrapper-api durationMs=${Date.now() - startedAt}`);
        return fallback;
      }
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
      const fallback = await this.tryScrapperApiFallback(word);
      if (fallback) {
        this.logger.log(`[crawlWord:fallback] word=${word} source=scrapper-api durationMs=${Date.now() - startedAt}`);
        return fallback;
      }
      return null;
    }

    this.logger.log(
      `[crawlWord:success] word=${word} canonical=${canonicalWord} meanings=${allMeanings.length} firstMeaning=${allMeanings[0]?.definition ?? ''} durationMs=${Date.now() - startedAt}`,
    );
    return { meanings: allMeanings, canonicalWord };
  }

  private async tryScrapperApiFallback(
    word: string,
  ): Promise<{ meanings: RawMeaning[]; canonicalWord: string } | null> {
    const apiUrl =
      process.env.SCRAPPER_API_URL?.trim() ||
      process.env.SCRAPER_API_URL?.trim() ||
      '';
    const apiKey =
      process.env.SCRAPPER_API_KEY?.trim() ||
      process.env.scrapper_api_key?.trim() ||
      process.env.SCRAPER_API_KEY?.trim() ||
      '';

    if (!apiUrl) {
      this.logger.debug(
        `[crawlWord:fallback-skip] word=${word} reason=no-scrapper-api-url`,
      );
      return null;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(apiKey
            ? {
                'x-api-key': apiKey,
                Authorization: `Bearer ${apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({ word }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        this.logger.warn(
          `[crawlWord:fallback-error] word=${word} status=${response.status} source=scrapper-api`,
        );
        return null;
      }

      const rawBody = await response.text();
      const trimmedBody = rawBody.trim();

      if (looksLikeCambridgeEntryPage(trimmedBody)) {
        const parsedFromHtml = this.parseCambridgeHtml(
          trimmedBody,
          word,
          response.url,
        );
        if (parsedFromHtml) return parsedFromHtml;
      }

      try {
        const payload = JSON.parse(trimmedBody) as ScrapperApiResponse;
        const parsedFromJson = this.parseScrapperApiPayload(payload, word);
        if (parsedFromJson) return parsedFromJson;
      } catch {
        // Ignore JSON parse errors and fall through to null.
      }

      this.logger.warn(
        `[crawlWord:fallback-error] word=${word} reason=no-usable-scrapper-response source=scrapper-api`,
      );
      return null;
    } catch (error) {
      this.logger.warn(
        `[crawlWord:fallback-error] word=${word} error=${(error as Error).message} source=scrapper-api`,
      );
      return null;
    }
  }

  private parseScrapperApiPayload(
    payload: unknown,
    fallbackWord: string,
  ): { meanings: RawMeaning[]; canonicalWord: string } | null {
    if (Array.isArray(payload)) {
      const meanings = normalizeApiMeanings(payload);
      if (meanings.length === 0) return null;

      return {
        meanings: this.sortAndLimit({ unknown: meanings }),
        canonicalWord: fallbackWord,
      };
    }

    if (!isRecord(payload)) return null;

    const canonicalWord =
      this.extractCanonicalWordFromPayload(payload) || fallbackWord;

    const html =
      this.extractHtmlFromPayload(payload) ||
      (typeof payload.data === 'string' ? payload.data : '');
    if (html && looksLikeCambridgeEntryPage(html)) {
      const parsed = this.parseCambridgeHtml(html, canonicalWord, '');
      if (parsed) return parsed;
    }

    const meanings = normalizeApiMeanings(
      getNestedValue(payload, ['meanings']) ??
        getNestedValue(payload, ['data', 'meanings']) ??
        getNestedValue(payload, ['wordMeanings']) ??
        getNestedValue(payload, ['data', 'wordMeanings']) ??
        getNestedValue(payload, ['data', 'word', 'wordMeanings']) ??
        getNestedValue(payload, ['data', 'data', 'wordMeanings']),
    );

    if (meanings.length === 0) return null;

    return {
      meanings: this.sortAndLimit({ unknown: meanings }),
      canonicalWord,
    };
  }

  private extractCanonicalWordFromPayload(payload: unknown): string {
    if (!isRecord(payload)) return '';

    const candidates = [
      payload.canonicalWord,
      getNestedValue(payload, ['data', 'canonicalWord']),
      getNestedValue(payload, ['word']),
      getNestedValue(payload, ['data', 'word']),
      getNestedValue(payload, ['data', 'word', 'word']),
      getNestedValue(payload, ['data', 'data', 'word']),
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toLowerCase();
      }
    }

    return '';
  }

  private extractHtmlFromPayload(payload: unknown): string {
    if (!isRecord(payload)) return '';

    const candidates = [
      payload.html,
      getNestedValue(payload, ['data', 'html']),
      getNestedValue(payload, ['data', 'data', 'html']),
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return '';
  }

  private parseCambridgeHtml(
    html: string,
    fallbackWord: string,
    responseUrl: string,
  ): { meanings: RawMeaning[]; canonicalWord: string } | null {
    const $ = cheerio.load(html);

    if (!$('.pr.dictionary, .entry-body, .di-title, .pr.entry-body__el').length) {
      return null;
    }

    const canonicalWord =
      this.extractCanonicalFromUrl(responseUrl) ||
      $('.hw.dhw').first().text().trim().toLowerCase() ||
      $('.di-title .hw').first().text().trim().toLowerCase() ||
      $('.headword').first().text().trim().toLowerCase() ||
      fallbackWord;

    const meaningsByPos: Record<string, RawMeaning[]> = {};
    const seenDefinitions = new Set<string>();

    this.scrapeEntryBlocks($, meaningsByPos, seenDefinitions);

    const phase1Total = Object.values(meaningsByPos).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

    if (phase1Total < MIN_MEANINGS_PHASE1) {
      this.logger.debug(
        `Phase 1 found ${phase1Total} meanings for "${fallbackWord}", running Phase 2 fallback`,
      );
      this.scrapePosBodies($, meaningsByPos, seenDefinitions);
    }

    const allMeanings = this.sortAndLimit(meaningsByPos);
    if (allMeanings.length === 0) return null;

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
            this.logger.debug(`Non-OK response: ${target} status=${response.status}`);
            if (attempt < 3) { await sleep(800 * attempt); continue; }
            continue;
          }

          const html = await response.text();
          const snippet = html.replace(/\s+/g, ' ').slice(0, 400);
          this.logger.debug(
            `[crawlWord:response] target=${target} attempt=${attempt} status=${response.status} url=${response.url} snippet=${snippet}`,
          );

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