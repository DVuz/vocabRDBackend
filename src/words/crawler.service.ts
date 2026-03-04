/**
 * CrawlerService
 * Ports the crawl logic from craw.js into a NestJS injectable service.
 * Called by WordService when a word is not found in the DB.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma.service';

// ─── constants ────────────────────────────────────────────────────────────────
const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org/dictionary/english';
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

// ─── raw meaning shape (internal) ─────────────────────────────────────────────
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

// ─── helpers (same logic as craw.js) ──────────────────────────────────────────
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
  return !bad.some(p => p.test(c));
}

function normalizePos(raw: string): string {
  const c = raw
    .replace(/[^\w\s]/g, '')
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
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
  return map[c] ?? c;
}

function fullAudioUrl(src: string | undefined): string {
  if (!src) return '';
  return src.startsWith('http') ? src : `https://dictionary.cambridge.org${src}`;
}

function normalizeDef(d: string): string {
  return cleanText(d)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(a: string, b: string): boolean {
  const na = normalizeDef(a),
    nb = normalizeDef(b);
  if (na === nb) return true;
  const [long, short] = na.length > nb.length ? [na, nb] : [nb, na];
  if (long.includes(short) && short.length / long.length > 0.7) return true;
  const wa = na.split(' ').filter(w => w.length > 3);
  const wb = nb.split(' ').filter(w => w.length > 3);
  if (wa.length > 3 && wb.length > 3) {
    const common = wa.filter(w => wb.includes(w));
    if (common.length / Math.min(wa.length, wb.length) > 0.6) return true;
  }
  return false;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── service ──────────────────────────────────────────────────────────────────
@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── public entry point ─────────────────────────────────────────────────────
  /**
   * Crawl a word from Cambridge, translate definitions, persist to DB,
   * and return data in the same shape as WordService.getWordWithMeanings().
   * Returns null if the word is not found on Cambridge.
   * Automatically resolves inflected forms (e.g. "dialects" → "dialect").
   */
  async crawlAndSave(wordString: string) {
    const word = wordString.trim().toLowerCase();
    this.logger.log(`Crawling "${word}" from Cambridge...`);

    const crawled = await this.crawlWord(word);
    if (!crawled || crawled.meanings.length === 0) {
      this.logger.warn(`"${word}" not found on Cambridge`);
      return null;
    }

    const { meanings: rawMeanings, canonicalWord } = crawled;

    if (canonicalWord !== word) {
      this.logger.log(`Cambridge resolved "${word}" → canonical form "${canonicalWord}"`);
      // If canonical form already exists in DB, return it directly
      const existing = await this.prisma.word.findUnique({
        where: { word: canonicalWord },
        include: { wordMeanings: true },
      });
      if (existing && existing.wordMeanings.length > 0) {
        this.logger.log(`"${canonicalWord}" already in DB, reusing`);
        return {
          wordId: existing.id,
          id: existing.id,
          word: existing.word,
          meanings: existing.wordMeanings.map(m => ({
            id: m.id,
            partOfSpeech: m.partOfSpeech,
            cefrLevel: m.cefrLevel,
            definition: m.definition,
            vnDefinition: m.vnDefinition,
            examples: (m.examples as string[]) ?? [],
            ipa: { uk: m.ukIpa, us: m.usIpa },
            audio: { uk: m.ukAudioUrl, us: m.usAudioUrl },
          })),
        };
      }
    }

    const meanings = await this.translateAll(rawMeanings);
    const result = await this.saveWord(canonicalWord, meanings);

    this.logger.log(`Saved "${canonicalWord}": wordId=${result.wordId}, ${meanings.length} meanings`);
    return result;
  }

  // ── Cambridge crawl (faithfully ported from craw.js) ──────────────────────
  private async crawlWord(
    word: string
  ): Promise<{ meanings: RawMeaning[]; canonicalWord: string } | null> {
    const url = `${CAMBRIDGE_BASE}/${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for "${word}"`);

    const html = await res.text();
    const $ = cheerio.load(html);

    if (!$('.pr.dictionary, .entry-body, .di-title, .pr.entry-body__el').length) return null;

    // Extract canonical headword from Cambridge page
    // Cambridge shows the base/lemma form regardless of the search term
    const canonicalWord =
      $('.hw.dhw').first().text().trim().toLowerCase() ||
      $('.di-title .hw').first().text().trim().toLowerCase() ||
      $('.headword').first().text().trim().toLowerCase() ||
      word;

    const meaningsByPos: Record<string, RawMeaning[]> = {};
    const seenDefs = new Set<string>();

    // ── Phase 1: entry-body__el ──────────────────────────────────────────────
    $('.pr.entry-body__el').each((_, entry) => {
      const $e = $(entry);
      const pos = normalizePos($e.find('.pos, .dpos, .posgram .pos').first().text().trim());
      if (!pos) return;

      const ukIpa = $e.find('.uk .pron .ipa, .uk.dpron .ipa').first().text().trim();
      const usIpa = $e.find('.us .pron .ipa, .us.dpron .ipa').first().text().trim();
      const ukAudio = fullAudioUrl(
        $e
          .find('.uk .daud audio source[type="audio/mpeg"], .uk.dpron audio source')
          .first()
          .attr('src')
      );
      const usAudio = fullAudioUrl(
        $e
          .find('.us .daud audio source[type="audio/mpeg"], .us.dpron audio source')
          .first()
          .attr('src')
      );

      if (!meaningsByPos[pos]) meaningsByPos[pos] = [];

      $e.find('.def-block, .ddef_block, .sense-block').each((_, sb) => {
        const $sb = $(sb);
        const rawDef = $sb.find('.def, .ddef_d').first().text().trim();
        if (!rawDef || !isValidDefinition(rawDef)) return;
        const def = cleanText(rawDef);
        for (const seen of seenDefs) if (isSimilar(def, seen)) return;
        seenDefs.add(def);

        const cefrLevel = $sb.find('.epp-xref, .def-info .epp-xref').first().text().trim();
        const examples: string[] = [];
        $sb.find('.examp .eg, .dexamp .deg, .eg').each((_, ex) => {
          if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false as any;
          const t = cleanText($(ex).text());
          if (t.length > 10) examples.push(t);
        });

        meaningsByPos[pos].push({
          pos,
          ukIpa,
          usIpa,
          ukAudio,
          usAudio,
          definition: def,
          cefrLevel,
          examples,
        });
      });
    });

    // ── Phase 2: fallback ────────────────────────────────────────────────────
    const totalFound = Object.values(meaningsByPos).reduce((s, a) => s + a.length, 0);
    if (totalFound < 3) {
      const globalUkIpa = $('.uk .pron .ipa').first().text().trim();
      const globalUsIpa = $('.us .pron .ipa').first().text().trim() || globalUkIpa;
      const globalUkAudio = fullAudioUrl(
        $('.uk .daud audio source[type="audio/mpeg"]').first().attr('src')
      );
      const globalUsAudio = fullAudioUrl(
        $('.us .daud audio source[type="audio/mpeg"]').first().attr('src')
      );

      $('.pos-body, .pv-body, .idiom-body').each((_, pb) => {
        const $pb = $(pb);
        const rawP =
          $pb.prevAll('.pos-header, .pos, .dpos-h').first().text().trim() ||
          $pb
            .closest('.entry-body__el, .entry, .di-body')
            .find('.pos, .dpos')
            .first()
            .text()
            .trim();
        const pos = normalizePos(rawP) || 'unknown';

        const ukIpa = $pb.find('.uk .pron .ipa').first().text().trim() || globalUkIpa;
        const usIpa = $pb.find('.us .pron .ipa').first().text().trim() || globalUsIpa;
        const ukAudio =
          fullAudioUrl($pb.find('.uk .daud audio source[type="audio/mpeg"]').first().attr('src')) ||
          globalUkAudio;
        const usAudio =
          fullAudioUrl($pb.find('.us .daud audio source[type="audio/mpeg"]').first().attr('src')) ||
          globalUsAudio;

        if (!meaningsByPos[pos]) meaningsByPos[pos] = [];

        $pb.find('.def-block, .ddef_block, .sense-block').each((_, sb) => {
          const $sb = $(sb);
          const rawDef = $sb.find('.def, .ddef_d').first().text().trim();
          if (!rawDef || !isValidDefinition(rawDef)) return;
          const def = cleanText(rawDef);
          for (const seen of seenDefs) if (isSimilar(def, seen)) return;
          seenDefs.add(def);

          const examples: string[] = [];
          $sb.find('.examp .eg, .dexamp .deg, .eg').each((_, ex) => {
            if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false as any;
            const t = cleanText($(ex).text());
            if (t.length > 10) examples.push(t);
          });

          meaningsByPos[pos].push({
            pos,
            ukIpa,
            usIpa,
            ukAudio,
            usAudio,
            definition: def,
            cefrLevel: $sb.find('.epp-xref').first().text().trim(),
            examples,
          });
        });
      });
    }

    // ── Sort by POS_ORDER & limit ────────────────────────────────────────────
    const sorted: RawMeaning[] = [];
    POS_ORDER.forEach(p => {
      if (meaningsByPos[p]) sorted.push(...meaningsByPos[p]);
    });
    Object.keys(meaningsByPos).forEach(p => {
      if (!POS_ORDER.includes(p)) sorted.push(...meaningsByPos[p]);
    });

    return { meanings: sorted.slice(0, MAX_MEANINGS_PER_WORD), canonicalWord };
  }

  // ── Translation ────────────────────────────────────────────────────────────
  private async translateToVi(text: string): Promise<string> {
    try {
      const url = TRANSLATE_API + encodeURIComponent(text);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return '';
      const raw = await res.text();
      const parsed = JSON.parse(raw);
      return parsed?.[0]?.[0]?.[0] ?? '';
    } catch {
      return '';
    }
  }

  private async translateAll(meanings: RawMeaning[]): Promise<RawMeaning[]> {
    const out: RawMeaning[] = [];
    for (const m of meanings) {
      const vn = await this.translateToVi(m.definition);
      out.push({ ...m, vnDefinition: vn });
      await sleep(TRANSLATE_DELAY_MS);
    }
    return out;
  }

  // ── Persist to DB (Prisma — same logic as craw.js saveWord) ───────────────
  private async saveWord(word: string, meanings: RawMeaning[]) {
    // Upsert word row
    await this.prisma.word.upsert({
      where: { word },
      create: { word },
      update: {},
    });

    const wordRow = await this.prisma.word.findUnique({ where: { word } });
    const wordId = wordRow!.id;

    // Fetch existing meanings + detect locked ones
    const existingMeanings = await this.prisma.wordMeaning.findMany({
      where: { wordId },
      select: { id: true },
    });
    const existingIds = existingMeanings.map(m => m.id);

    let lockedIds = new Set<number>();
    if (existingIds.length > 0) {
      const [uwRows, wliRows, rsiRows] = await Promise.all([
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
      for (const r of uwRows) lockedIds.add(r.wordMeaningId);
      for (const r of wliRows) lockedIds.add(r.wordMeaningId);
      for (const r of rsiRows) lockedIds.add(r.userWord.wordMeaningId);
    }

    // Delete unlocked old meanings
    const toDelete = existingIds.filter(id => !lockedIds.has(id));
    if (toDelete.length > 0) {
      await this.prisma.wordMeaning.deleteMany({ where: { id: { in: toDelete } } });
    }

    // Insert new meanings
    const created = await this.prisma.$transaction(
      meanings.map(m =>
        this.prisma.wordMeaning.create({
          data: {
            wordId,
            definition: m.definition,
            vnDefinition: m.vnDefinition ?? '',
            partOfSpeech: m.pos || null,
            examples: m.examples ?? [],
            cefrLevel: m.cefrLevel || null,
            ukIpa: m.ukIpa || null,
            usIpa: m.usIpa || null,
            ukAudioUrl: m.ukAudio || null,
            usAudioUrl: m.usAudio || null,
          },
        })
      )
    );

    // Return in the same shape as WordService.getWordWithMeanings
    return {
      wordId,
      id: wordId,
      word,
      meanings: created.map(m => ({
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
