import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { chromium, type BrowserContext } from 'playwright';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Crawl dữ liệu từ điển theo chuỗi nguồn:
 *   1. Cambridge (có CEFR, audio UK/US chuẩn) – qua FlareSolverr nếu có cấu hình
 *   2. dictionaryapi.dev (miễn phí, không bị chặn)
 *
 * ENV (tuỳ chọn):
 *   CAMBRIDGE_MODE=playwright|flaresolverr|fetch  (mặc định: playwright,
 *                                                  hoặc flaresolverr nếu có FLARESOLVERR_URL)
 *   FLARESOLVERR_URL=http://localhost:8191/v1
 *   PLAYWRIGHT_HEADLESS=true      → chạy ẩn (mặc định false: hiện cửa sổ Chrome, dễ qua Cloudflare hơn)
 *   PLAYWRIGHT_CHANNEL=chrome     → dùng Chrome cài sẵn (mặc định), đặt rỗng để dùng Chromium của Playwright
 *   PLAYWRIGHT_PROFILE_DIR=.playwright-profile  → lưu cookie, lần sau ít bị challenge hơn
 *   DISABLE_CAMBRIDGE=true        → bỏ qua Cambridge hoàn toàn
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org';
const CAMBRIDGE_ENTRY_URL = `${CAMBRIDGE_BASE}/dictionary/english/`;
const CAMBRIDGE_SEARCH_URL = `${CAMBRIDGE_BASE}/search/english/direct/?q=`;
const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const TRANSLATE_API =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_EXAMPLES_PER_SENSE = 3;
const MAX_MEANINGS_PER_WORD = 15;
const MAX_MEANINGS_PER_POS_API = 5;
const TRANSLATE_BATCH_SIZE = 4;
const TRANSLATE_BATCH_DELAY_MS = 200;
const CAMBRIDGE_BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
const CEFR_REGEX = /^[ABC][12]$/i;

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
  'interjection',
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

type Source = 'cambridge' | 'dictionaryapi';

interface ParsedEntry {
  canonicalWord: string;
  meanings: RawMeaning[];
  source: Source;
}

interface FetchedPage {
  html: string;
  url: string;
}

interface Pron {
  ukIpa: string;
  usIpa: string;
  ukAudio: string;
  usAudio: string;
}

interface DictApiEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: {
    partOfSpeech: string;
    definitions: { definition: string; example?: string }[];
  }[];
}

class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function cleanText(text: string): string {
  return text
    .replace(/→\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-•→►]\s*/, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s*\|\s*/g, ' ')
    .trim();
}

function cleanDefinition(text: string): string {
  return cleanText(text).replace(/\s*:\s*$/, '').trim();
}

function isValidDefinition(def: string): boolean {
  const cleaned = cleanText(def);
  if (cleaned.length < 5) return false;
  if (!/[a-zA-Z]/.test(cleaned)) return false;

  const blacklist = [
    /^see also/i,
    /^compare/i,
    /^opposite/i,
    /^related/i,
    /^idioms?:/i,
    /^phrasal verbs?:/i,
  ];
  return !blacklist.some((p) => p.test(cleaned));
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
  };
  return mapping[cleaned] ?? cleaned;
}

function cambridgeUrl(src: string | undefined): string {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return `${CAMBRIDGE_BASE}${src}`;
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
  const hasEntryMarkers =
    /entry-body__el|class="pr dictionary"|class="di-title"|class="headword"|class="hw/i.test(
      html,
    ) || /def-block|ddef_d|sense-block/i.test(html);
  const hasDictionarySignals =
    /dictionary\.cambridge\.org|cambridge dictionary/i.test(html);
  return hasDictionarySignals && hasEntryMarkers;
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class CambridgeCrawlerService implements OnModuleDestroy {
  private readonly logger = new Logger(CambridgeCrawlerService.name);

  /** Playwright: 1 browser context dùng chung, các lượt crawl chạy lần lượt */
  private contextPromise: Promise<BrowserContext> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  async onModuleDestroy(): Promise<void> {
    if (!this.contextPromise) return;
    try {
      const context = await this.contextPromise;
      await context.close();
    } catch {
      // ignore
    }
    this.contextPromise = null;
  }

  /** Tránh crawl trùng khi nhiều request cùng tra một từ */
  private readonly inflight = new Map<
    string,
    Promise<{ canonicalWord: string } | null>
  >();

  /** Circuit breaker cho Cambridge */
  private cambridgeBlockedUntil = 0;

  constructor(private readonly prisma: PrismaService) {}

  // ── Public entry point ─────────────────────────────────────────────────────
  async crawlAndSave(
    searchWord: string,
  ): Promise<{ canonicalWord: string } | null> {
    const word = searchWord.trim().toLowerCase().replace(/\s+/g, ' ');

    // Word.word là VarChar(100) và chỉ chấp nhận chữ cái, khoảng trắng, ' - .
    if (!word || word.length > 100 || !/^[a-z][a-z\s'\-.]*$/.test(word)) {
      this.logger.warn(`Invalid word skipped: "${searchWord}"`);
      return null;
    }

    const existing = this.inflight.get(word);
    if (existing) return existing;

    const task = this.doCrawlAndSave(word).finally(() =>
      this.inflight.delete(word),
    );
    this.inflight.set(word, task);
    return task;
  }

  private async doCrawlAndSave(
    word: string,
  ): Promise<{ canonicalWord: string } | null> {
    const startedAt = Date.now();
    const entry = await this.fetchEntry(word);

    if (!entry) {
      this.logger.warn(`"${word}" not found in any source`);
      return null;
    }

    const { canonicalWord, meanings, source } = entry;
    const translated = await this.translateAll(meanings);

    await this.saveWord(canonicalWord, translated);

    if (canonicalWord !== word) {
      await this.saveAlias(word, canonicalWord);
      this.logger.log(`Alias saved: "${word}" → "${canonicalWord}"`);
    }

    this.logger.log(
      `[crawl:done] word=${word} canonical=${canonicalWord} source=${source} meanings=${translated.length} durationMs=${Date.now() - startedAt}`,
    );
    return { canonicalWord };
  }

  // ── Source chain ───────────────────────────────────────────────────────────
  private async fetchEntry(word: string): Promise<ParsedEntry | null> {
    const sources: Array<[Source, () => Promise<ParsedEntry | null>]> = [
      ['cambridge', () => this.fetchFromCambridge(word)],
      ['dictionaryapi', () => this.fetchFromDictionaryApi(word)],
    ];

    for (const [name, run] of sources) {
      try {
        const result = await run();
        if (result && result.meanings.length > 0) return result;
        this.logger.debug(`[source:${name}] no data for "${word}"`);
      } catch (error) {
        this.logger.warn(
          `[source:${name}] error for "${word}": ${(error as Error).message}`,
        );
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE 1: CAMBRIDGE
  // ═══════════════════════════════════════════════════════════════════════════
  private async fetchFromCambridge(word: string): Promise<ParsedEntry | null> {
    if (process.env.DISABLE_CAMBRIDGE === 'true') return null;

    if (Date.now() < this.cambridgeBlockedUntil) {
      this.logger.debug('[cambridge] circuit open, skipping');
      return null;
    }

    const page = await this.fetchCambridgePage(word);
    if (!page) return null;

    return this.parseCambridge(page, word);
  }

  private async fetchCambridgePage(word: string): Promise<FetchedPage | null> {
    const slug = encodeURIComponent(word.replace(/\s+/g, '-'));
    const targets = [
      `${CAMBRIDGE_SEARCH_URL}${encodeURIComponent(word)}`, // tự redirect về canonical
      `${CAMBRIDGE_ENTRY_URL}${slug}`,
    ];

    for (const target of targets) {
      try {
        const mode =
          process.env.CAMBRIDGE_MODE ||
          (process.env.FLARESOLVERR_URL ? 'flaresolverr' : 'playwright');

        const page =
          mode === 'flaresolverr'
            ? await this.viaFlareSolverr(target)
            : mode === 'fetch'
              ? await this.viaFetch(target)
              : await this.viaPlaywright(target);

        if (page && looksLikeCambridgeEntryPage(page.html)) return page;
      } catch (error) {
        if (error instanceof BlockedError) {
          this.cambridgeBlockedUntil = Date.now() + CAMBRIDGE_BLOCK_COOLDOWN_MS;
          this.logger.warn(
            `[cambridge] blocked (${error.message}) → pause ${CAMBRIDGE_BLOCK_COOLDOWN_MS / 60000} min`,
          );
          return null; // không retry khi bị chặn
        }
        this.logger.debug(
          `[cambridge] ${target} failed: ${(error as Error).message}`,
        );
      }
    }
    return null;
  }

  // ── Playwright ─────────────────────────────────────────────────────────────
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private getContext(): Promise<BrowserContext> {
    if (!this.contextPromise) {
      const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';

      this.contextPromise = chromium
        .launchPersistentContext(
          process.env.PLAYWRIGHT_PROFILE_DIR ?? '.playwright-profile',
          {
            ...(channel ? { channel } : {}),
            headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
            locale: 'en-US',
            viewport: { width: 1280, height: 800 },
            args: ['--disable-blink-features=AutomationControlled'],
            ignoreDefaultArgs: ['--enable-automation'],
          },
        )
        .then(async (context) => {
          // Bỏ ảnh/font/media cho nhanh (audio chỉ cần URL trong HTML)
          await context.route('**/*', (route) =>
            ['image', 'font', 'media'].includes(route.request().resourceType())
              ? route.abort()
              : route.continue(),
          );
          return context;
        })
        .catch((error) => {
          this.contextPromise = null; // cho phép thử khởi tạo lại lần sau
          throw error;
        });
    }
    return this.contextPromise;
  }

  private viaPlaywright(url: string): Promise<FetchedPage | null> {
    return this.runExclusive(async () => {
      const context = await this.getContext();
      const page = await context.newPage();

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Nếu gặp Cloudflare challenge, đợi nó tự giải xong và hiện nội dung từ điển
        await page
          .waitForSelector(
            '.entry-body__el, .pos-body, .di-title, .headword, .hw.dhw',
            { timeout: 20000 },
          )
          .catch(() => undefined);

        const html = await page.content();
        if (looksLikeCambridgeEntryPage(html)) {
          return { html, url: page.url() };
        }

        if (response?.status() === 404) return null;

        if (
          /just a moment|cf-challenge|attention required|verify you are human/i.test(
            html,
          ) ||
          [403, 429, 503].includes(response?.status() ?? 200)
        ) {
          throw new BlockedError(
            `Cloudflare challenge not solved (HTTP ${response?.status()})`,
          );
        }
        return null;
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  private async viaFetch(url: string): Promise<FetchedPage | null> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });

    if ([403, 429, 503].includes(response.status)) {
      throw new BlockedError(`HTTP ${response.status}`);
    }
    if (!response.ok) return null;

    return { html: await response.text(), url: response.url };
  }

  private async viaFlareSolverr(url: string): Promise<FetchedPage | null> {
    const response = await fetch(process.env.FLARESOLVERR_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url,
        maxTimeout: 45000,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`FlareSolverr HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      status?: string;
      solution?: { url?: string; status?: number; response?: string };
    };

    const solution = json.solution;
    if (json.status !== 'ok' || !solution?.response) {
      throw new BlockedError('FlareSolverr could not solve challenge');
    }
    if ([403, 429, 503].includes(solution.status ?? 200)) {
      throw new BlockedError(`HTTP ${solution.status} via FlareSolverr`);
    }
    if (solution.status === 404) return null;

    return { html: solution.response, url: solution.url ?? url };
  }

  // ── Cambridge parser ───────────────────────────────────────────────────────
  private parseCambridge(page: FetchedPage, word: string): ParsedEntry | null {
    const $ = cheerio.load(page.html);

    // Chỉ lấy từ điển đầu tiên (British) để tránh trùng với American/Business
    let $root = $('.pr.dictionary').first();
    if (!$root.length) $root = $('body');

    if (!$root.find('.entry-body__el, .pos-body, .pv-block').length) {
      return null;
    }

    const canonicalWord =
      this.extractCanonicalFromUrl(page.url) ||
      $root.find('.hw.dhw').first().text().trim().toLowerCase() ||
      $root.find('.headword .hw').first().text().trim().toLowerCase() ||
      word;

    const pagePron = this.readPron($, $root);

    // Lượt 1: chỉ nghĩa chính. Lượt 2 (nếu rỗng): thêm phrasal verb / idiom
    let byPos = this.scrapeCambridgeEntries($, $root, pagePron, false);
    if (Object.keys(byPos).length === 0) {
      byPos = this.scrapeCambridgeEntries($, $root, pagePron, true);
    }

    const meanings = this.sortAndLimit(byPos);
    if (meanings.length === 0) return null;

    return { canonicalWord, meanings, source: 'cambridge' };
  }

  private scrapeCambridgeEntries(
    $: cheerio.CheerioAPI,
    $root: cheerio.Cheerio<any>,
    pagePron: Pron,
    includeIdioms: boolean,
  ): Record<string, RawMeaning[]> {
    const byPos: Record<string, RawMeaning[]> = {};
    const seen = new Set<string>();

    $root.find('.entry-body__el').each((_, entryEl) => {
      const $entry = $(entryEl);

      const rawPos = $entry
        .find('.pos-header .pos, .posgram .pos, .pos.dpos')
        .first()
        .text()
        .trim();
      const pos = normalizePos(rawPos) || 'unknown';

      const own = this.readPron($, $entry);
      const pron: Pron = {
        ukIpa: own.ukIpa || pagePron.ukIpa,
        usIpa: own.usIpa || pagePron.usIpa,
        ukAudio: own.ukAudio || pagePron.ukAudio,
        usAudio: own.usAudio || pagePron.usAudio,
      };

      $entry.find('.def-block, .ddef_block').each((__, block) => {
        const $block = $(block);

        // Bỏ qua nghĩa nằm trong idiom / phrasal verb / phrase (trừ lượt 2)
        if (
          !includeIdioms &&
          $block.closest('.idiom-block, .phrase-block, .pv-block, .xref').length
        ) {
          return;
        }

        const meaning = this.parseCambridgeSense($, block, pos, pron, seen);
        if (meaning) {
          if (!byPos[pos]) byPos[pos] = [];
          byPos[pos].push(meaning);
        }
      });
    });

    return byPos;
  }

  private parseCambridgeSense(
    $: cheerio.CheerioAPI,
    block: Element,
    pos: string,
    pron: Pron,
    seen: Set<string>,
  ): RawMeaning | null {
    const $block = $(block);

    const rawDef = $block.find('.ddef_d, .def').first().text();
    if (!rawDef || !isValidDefinition(rawDef)) return null;

    const definition = cleanDefinition(rawDef);
    for (const s of seen) {
      if (isSimilar(definition, s)) return null;
    }
    seen.add(definition);

    const cefrRaw = $block.find('.epp-xref').first().text().trim();
    const cefrLevel = CEFR_REGEX.test(cefrRaw) ? cefrRaw.toUpperCase() : '';

    const examples: string[] = [];
    $block.find('.examp .eg').each((_, el) => {
      if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false;
      const text = cleanText($(el).text());
      if (text.length > 10) examples.push(text);
    });

    return { pos, ...pron, definition, cefrLevel, examples };
  }

  private readPron($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>): Pron {
    const read = (region: 'uk' | 'us') => {
      let $r = $scope.find(`.${region}.dpron-i`).first();
      if (!$r.length) $r = $scope.find(`.${region}`).first();
      return {
        ipa: $r.find('.ipa').first().text().trim(),
        audio: cambridgeUrl(
          $r.find('source[type="audio/mpeg"]').first().attr('src') ||
            $r.find('source').first().attr('src'),
        ),
      };
    };

    const uk = read('uk');
    const us = read('us');
    return {
      ukIpa: uk.ipa,
      usIpa: us.ipa || uk.ipa,
      ukAudio: uk.audio,
      usAudio: us.audio || uk.audio,
    };
  }

  /** /dictionary/english/run → "run" (bỏ qua route đặc biệt) */
  private extractCanonicalFromUrl(url: string): string {
    try {
      const { pathname } = new URL(url);
      const marker = '/dictionary/english/';
      const index = pathname.indexOf(marker);
      if (index < 0) return '';

      const segment = decodeURIComponent(
        pathname.slice(index + marker.length).split('/')[0].trim().toLowerCase(),
      );
      if (!segment || ['check', 'search', 'direct'].includes(segment)) return '';

      return segment.replace(/-/g, ' ');
    } catch {
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE 2: dictionaryapi.dev
  // ═══════════════════════════════════════════════════════════════════════════
  private async fetchFromDictionaryApi(
    word: string,
  ): Promise<ParsedEntry | null> {
    const response = await fetch(`${DICTIONARY_API}${encodeURIComponent(word)}`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null; // 404 = không có từ này

    const data = (await response.json()) as DictApiEntry[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const canonicalWord = (data[0].word || word).trim().toLowerCase();
    const pron = this.pickApiPron(data);

    const byPos: Record<string, RawMeaning[]> = {};
    const seen = new Set<string>();

    for (const entry of data) {
      for (const meaningGroup of entry.meanings ?? []) {
        const pos = normalizePos(meaningGroup.partOfSpeech || '') || 'unknown';

        for (const def of meaningGroup.definitions ?? []) {
          if (!def.definition || !isValidDefinition(def.definition)) continue;
          if ((byPos[pos]?.length ?? 0) >= MAX_MEANINGS_PER_POS_API) break;

          const definition = cleanDefinition(def.definition);
          if ([...seen].some((s) => isSimilar(definition, s))) continue;
          seen.add(definition);

          const example = def.example ? cleanText(def.example) : '';

          if (!byPos[pos]) byPos[pos] = [];
          byPos[pos].push({
            pos,
            ...pron,
            definition,
            cefrLevel: '',
            examples: example.length > 10 ? [example] : [],
          });
        }
      }
    }

    const meanings = this.sortAndLimit(byPos);
    if (meanings.length === 0) return null;

    return { canonicalWord, meanings, source: 'dictionaryapi' };
  }

  private pickApiPron(entries: DictApiEntry[]): Pron {
    const phonetics = entries.flatMap((e) => e.phonetics ?? []);
    const fallbackText =
      entries.map((e) => e.phonetic).find(Boolean) ||
      phonetics.find((p) => p.text)?.text ||
      '';

    const find = (tag: 'uk' | 'us') =>
      phonetics.find((p) => p.audio && p.audio.toLowerCase().includes(`-${tag}.`));

    const uk = find('uk');
    const us = find('us');
    const anyAudio = phonetics.find((p) => p.audio)?.audio ?? '';

    return {
      ukIpa: uk?.text || fallbackText,
      usIpa: us?.text || fallbackText,
      ukAudio: uk?.audio || anyAudio,
      usAudio: us?.audio || anyAudio,
    };
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  private sortAndLimit(byPos: Record<string, RawMeaning[]>): RawMeaning[] {
    const sorted: RawMeaning[] = [];

    for (const pos of POS_ORDER) {
      if (byPos[pos]) sorted.push(...byPos[pos]);
    }
    for (const pos of Object.keys(byPos)) {
      if (!POS_ORDER.includes(pos)) sorted.push(...byPos[pos]);
    }

    return sorted.slice(0, MAX_MEANINGS_PER_WORD);
  }

  // ── Translation ────────────────────────────────────────────────────────────
  private async translateToVi(text: string): Promise<string> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(TRANSLATE_API + encodeURIComponent(text), {
          headers: { 'User-Agent': BROWSER_UA },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const parsed = await response.json();
        // parsed[0] là mảng các đoạn dịch → ghép lại (câu dài bị tách nhiều đoạn)
        const segments: unknown[] = Array.isArray(parsed?.[0]) ? parsed[0] : [];
        const joined = segments
          .map((s) => (Array.isArray(s) ? (s[0] as string) : ''))
          .join('')
          .trim();
        if (joined) return joined;
      } catch {
        if (attempt < 2) await sleep(400);
      }
    }
    return '';
  }

  private async translateAll(meanings: RawMeaning[]): Promise<RawMeaning[]> {
    const output: RawMeaning[] = [];

    for (let i = 0; i < meanings.length; i += TRANSLATE_BATCH_SIZE) {
      const batch = meanings.slice(i, i + TRANSLATE_BATCH_SIZE);
      const translated = await Promise.all(
        batch.map(async (m) => ({
          ...m,
          vnDefinition: await this.translateToVi(m.definition),
        })),
      );
      output.push(...translated);
      if (i + TRANSLATE_BATCH_SIZE < meanings.length) {
        await sleep(TRANSLATE_BATCH_DELAY_MS);
      }
    }
    return output;
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  private async saveAlias(alias: string, canonicalWord: string): Promise<void> {
    if (alias === canonicalWord) return;
    try {
      await this.prisma.wordAlias.upsert({
        where: { alias },
        create: { alias, canonicalWord },
        update: { canonicalWord },
      });
    } catch {
      // Non-critical — bỏ qua lỗi trùng / race
    }
  }

  private async saveWord(word: string, meanings: RawMeaning[]): Promise<void> {
    const first = meanings[0];

    const wordRow = await this.prisma.word.upsert({
      where: { word },
      create: {
        word,
        ukIpa: first?.ukIpa || null,
        usIpa: first?.usIpa || null,
        ukAudioUrl: first?.ukAudio || null,
        usAudioUrl: first?.usAudio || null,
      },
      update: {
        // undefined = giữ nguyên giá trị cũ nếu nguồn mới không có
        ukIpa: first?.ukIpa || undefined,
        usIpa: first?.usIpa || undefined,
        ukAudioUrl: first?.ukAudio || undefined,
        usAudioUrl: first?.usAudio || undefined,
      },
    });
    const wordId = wordRow.id;

    const existing = await this.prisma.wordMeaning.findMany({
      where: { wordId },
      select: { id: true, definition: true },
    });
    const existingIds = existing.map((m) => m.id);

    // Meanings đang được user dùng → không được xoá
    const lockedIds = new Set<number>();
    if (existingIds.length > 0) {
      const [userWords, listItems, sessionItems] = await Promise.all([
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
      userWords.forEach((r) => lockedIds.add(r.wordMeaningId));
      listItems.forEach((r) => lockedIds.add(r.wordMeaningId));
      sessionItems.forEach((r) => lockedIds.add(r.userWord.wordMeaningId));
    }

    await this.prisma.$transaction(async (tx) => {
      const matchedIds = new Set<number>();

      for (const m of meanings) {
        const data = {
          definition: m.definition,
          vnDefinition: m.vnDefinition ?? '',
          partOfSpeech: m.pos || null,
          examples: m.examples ?? [],
          cefrLevel: m.cefrLevel || null,
          ukIpa: m.ukIpa || null,
          usIpa: m.usIpa || null,
          ukAudioUrl: m.ukAudio || null,
          usAudioUrl: m.usAudio || null,
        };

        // Nghĩa đã có (giống định nghĩa) → cập nhật tại chỗ, giữ nguyên id
        // để không làm mất liên kết UserWord / WordListItem
        const match = existing.find(
          (e) => !matchedIds.has(e.id) && isSimilar(e.definition, m.definition),
        );

        if (match) {
          matchedIds.add(match.id);
          await tx.wordMeaning.update({ where: { id: match.id }, data });
        } else {
          await tx.wordMeaning.create({ data: { wordId, ...data } });
        }
      }

      // Xoá nghĩa cũ không còn xuất hiện VÀ không bị khoá
      const idsToDelete = existingIds.filter(
        (id) => !matchedIds.has(id) && !lockedIds.has(id),
      );
      if (idsToDelete.length > 0) {
        await tx.wordMeaning.deleteMany({ where: { id: { in: idsToDelete } } });
      }
    });
  }
}