/**
 * pg/crawl-words-pg.js
 * Crawl từ Cambridge Dictionary → lưu vào PostgreSQL theo pg/schema-postgres.sql
 *
 * Cách dùng:
 *   node pg/crawl-words-pg.js
 *   node pg/crawl-words-pg.js --file ListWord/ABC.txt
 *   node pg/crawl-words-pg.js --file ListWord/ABC.txt --start 50
 *   node pg/crawl-words-pg.js --file ListWord/ABC.txt --word "table"
 *   node pg/crawl-words-pg.js --file ListWord/ABC.txt --skip-existing
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cheerio = require('cheerio');
const { Pool } = require('pg');

// Load .env từ thư mục gốc (một cấp trên pg/)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─────────────────────────────────────────────────────────────
// 1. CONFIG — đọc từ .env (PG_HOST, PG_PORT, PG_USERNAME, PG_PASSWORD, PG_DATABASE)
// ─────────────────────────────────────────────────────────────
const PG_SCHEMA = process.env.PG_SCHEMA || 'vocab';

const DB_CONFIG = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USERNAME || process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'postgres',
  max: 3,
  options: `-c search_path=${process.env.PG_SCHEMA || 'vocab'}`,
};

const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org/dictionary/english';
const TRANSLATE_API =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=';

const DELAY_BETWEEN_WORDS_MS = 1500;
const DELAY_ON_RETRY_MS = 5000;
const MAX_RETRIES = 3;
const MAX_EXAMPLES_PER_SENSE = 3;
const MAX_MEANINGS_PER_WORD = 15;

// ─────────────────────────────────────────────────────────────
// 2. HELPERS — clean / validate (giống crawl-words.js gốc)
// ─────────────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/→\s*/g, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[\-\•\→\►]\s*/g, '')
    .replace(/^\s*\d+\.\s*/g, '')
    .replace(/\s*\|\s*/g, ' ')
    .trim();
}

function isValidDefinition(def) {
  const c = cleanText(def);
  if (c.length < 10) return false;
  if (!/[a-zA-Z]/.test(c)) return false;
  const bad = [
    /^memory address$/i,
    /^→\s*$/,
    /^[\s\n\r\t]*$/,
    /^[\d\s\-\•\→\►]*$/,
    /^see also/i,
    /^compare/i,
    /^opposite/i,
    /^related/i,
    /^idioms?:/i,
    /^phrasal verbs?:/i,
  ];
  return !bad.some(p => p.test(c));
}

function normalizePos(raw) {
  const c = raw
    .replace(/[^\w\s]/g, '')
    .trim()
    .toLowerCase();
  const map = {
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
  return map[c] || c;
}

function fullAudioUrl(src) {
  if (!src) return '';
  return src.startsWith('http') ? src : `https://dictionary.cambridge.org${src}`;
}

function normalizeDef(d) {
  return cleanText(d)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(a, b) {
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────
// 3. TRANSLATE
// ─────────────────────────────────────────────────────────────
async function translateToVi(text) {
  try {
    const url = TRANSLATE_API + encodeURIComponent(text);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const raw = await res.text();
    const parsed = JSON.parse(raw);
    return parsed?.[0]?.[0]?.[0] || '';
  } catch {
    return '';
  }
}

async function translateAllDefinitions(meanings) {
  const results = [];
  for (const m of meanings) {
    const vn = await translateToVi(m.definition);
    results.push({ ...m, vnDefinition: vn });
    await sleep(300);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// 4. CRAWL — Cambridge Dictionary (không thay đổi so với bản MySQL)
// ─────────────────────────────────────────────────────────────
async function crawlWord(word) {
  const url = `${CAMBRIDGE_BASE}/${encodeURIComponent(word.trim().toLowerCase())}`;
  console.log(`  🌐 ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  if (!$('.pr.dictionary, .entry-body, .di-title, .pr.entry-body__el').length) {
    return null;
  }

  const meaningsByPos = {};
  const seenDefs = new Set();

  // ── PHASE 1: entry-body__el ───────────────────────────────
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

      for (const seen of seenDefs) {
        if (isSimilar(def, seen)) return;
      }
      seenDefs.add(def);

      const cefrLevel = $sb.find('.epp-xref, .def-info .epp-xref').first().text().trim();

      const examples = [];
      $sb.find('.examp .eg, .dexamp .deg, .eg').each((_, ex) => {
        if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false;
        const t = cleanText($(ex).text());
        if (t.length > 10) examples.push(t);
      });

      const grammar = $sb
        .find('.gram, .dgram, .gc')
        .first()
        .text()
        .trim()
        .replace(/[\[\]]/g, '')
        .trim();
      const usageLabel = $sb.find('.usage, .rusage, .lab, .dlab').first().text().trim();
      const domain = $sb.find('.domain, .ddomain').first().text().trim();
      const register = $sb.find('.register, .dregister').first().text().trim();
      const guideWord = $sb
        .closest('.pr.entry-body__el')
        .find('.dpos-g .guideword, .pos-header .guideword')
        .first()
        .text()
        .trim()
        .replace(/\(|\)/g, '')
        .trim();

      meaningsByPos[pos].push({
        pos,
        ukIpa,
        usIpa,
        ukAudio,
        usAudio,
        definition: def,
        cefrLevel,
        grammar: grammar || null,
        usageLabel: usageLabel || null,
        domain: domain || null,
        register: register || null,
        guideWord: guideWord || null,
        examples,
      });
    });
  });

  // ── PHASE 2: fallback ────────────────────────────────────
  const total_found = Object.values(meaningsByPos).reduce((s, a) => s + a.length, 0);
  if (total_found < 3) {
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
        $pb.closest('.entry-body__el, .entry, .di-body').find('.pos, .dpos').first().text().trim();
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
        for (const seen of seenDefs) {
          if (isSimilar(def, seen)) return;
        }
        seenDefs.add(def);

        const examples = [];
        $sb.find('.examp .eg, .dexamp .deg, .eg').each((_, ex) => {
          if (examples.length >= MAX_EXAMPLES_PER_SENSE) return false;
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
          grammar: null,
          usageLabel: null,
          domain: null,
          register: null,
          guideWord: null,
          examples,
        });
      });
    });
  }

  // ── Sắp xếp & giới hạn ───────────────────────────────────
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
  const sorted = [];
  POS_ORDER.forEach(p => {
    if (meaningsByPos[p]) sorted.push(...meaningsByPos[p]);
  });
  Object.keys(meaningsByPos).forEach(p => {
    if (!POS_ORDER.includes(p)) sorted.push(...meaningsByPos[p]);
  });

  return sorted.slice(0, MAX_MEANINGS_PER_WORD);
}

// ─────────────────────────────────────────────────────────────
// 5. DATABASE — lưu từ vào PostgreSQL
// Key thay đổi so với MySQL:
//  - pool.connect() thay vì pool.getConnection()
//  - client.query('BEGIN/COMMIT/ROLLBACK') thay vì conn.beginTransaction()
//  - params dùng $1/$2/... thay vì ?
//  - INSERT ... RETURNING id để lấy id mới
//  - ON CONFLICT DO NOTHING thay vì ON DUPLICATE KEY UPDATE
// ─────────────────────────────────────────────────────────────
async function saveWord(pool, word, meanings) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Upsert words ─────────────────────────────────────────
    await client.query('INSERT INTO words (word) VALUES ($1) ON CONFLICT (word) DO NOTHING', [
      word.toLowerCase(),
    ]);
    const {
      rows: [wordRow],
    } = await client.query('SELECT id FROM words WHERE word = $1', [word.toLowerCase()]);
    const wordId = wordRow.id;

    // ── Lấy meanings hiện có ─────────────────────────────────
    const { rows: existingMeanings } = await client.query(
      'SELECT id, definition, part_of_speech FROM word_meanings WHERE word_id = $1',
      [wordId]
    );

    // ── Kiểm tra meanings bị khoá (đang được user học) ───────
    const existingIds = existingMeanings.map(m => m.id);
    let lockedIds = new Set();

    if (existingIds.length > 0) {
      const placeholders = existingIds.map((_, i) => `$${i + 1}`).join(',');
      const { rows: lockedRows } = await client.query(
        `SELECT DISTINCT word_meaning_id FROM user_words WHERE word_meaning_id IN (${placeholders})
         UNION
         SELECT DISTINCT word_meaning_id FROM word_list_items WHERE word_meaning_id IN (${placeholders})
         UNION
         SELECT DISTINCT word_meaning_id FROM review_session_items WHERE word_meaning_id IN (${placeholders})`,
        [...existingIds, ...existingIds, ...existingIds]
      );
      lockedIds = new Set(lockedRows.map(r => r.word_meaning_id));
    }

    // ── Xoá meanings cũ không bị khoá ────────────────────────
    for (const em of existingMeanings) {
      if (!lockedIds.has(em.id)) {
        await client.query('DELETE FROM word_meanings WHERE id = $1', [em.id]);
      }
    }

    // ── Insert meanings mới ───────────────────────────────────
    const insertedIds = [];
    for (const m of meanings) {
      const {
        rows: [inserted],
      } = await client.query(
        `INSERT INTO word_meanings
          (word_id, definition, vn_definition, part_of_speech, examples,
           cefr_level, uk_ipa, us_ipa, uk_audio_url, us_audio_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          wordId,
          m.definition,
          m.vnDefinition || '',
          m.pos || null,
          JSON.stringify(m.examples || []),
          m.cefrLevel || null,
          m.ukIpa || null,
          m.usIpa || null,
          m.ukAudio || null,
          m.usAudio || null,
        ]
      );
      insertedIds.push(inserted.id);
    }

    await client.query('COMMIT');
    return { wordId, insertedIds, lockedCount: lockedIds.size };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function wordExists(pool, word) {
  const { rows } = await pool.query('SELECT id FROM words WHERE word = $1', [word.toLowerCase()]);
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────
// 6. PROGRESS — lưu/đọc tiến độ
// ─────────────────────────────────────────────────────────────
function progressFile(wordFile) {
  return wordFile.replace(/\.[^.]+$/, '') + '.progress.json';
}

function loadProgress(wordFile) {
  const pf = progressFile(wordFile);
  if (fs.existsSync(pf)) {
    try {
      return JSON.parse(fs.readFileSync(pf, 'utf8'));
    } catch {}
  }
  return { done: [], failed: [] };
}

function saveProgress(wordFile, progress) {
  fs.writeFileSync(progressFile(wordFile), JSON.stringify(progress, null, 2));
}

// ─────────────────────────────────────────────────────────────
// 7. PROMPT HELPER
// ─────────────────────────────────────────────────────────────
function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function promptConfig(rl) {
  console.log('\n📋 Cấu hình kết nối PostgreSQL (Enter để dùng giá trị mặc định):');
  const host = await ask(rl, `  Host     [${DB_CONFIG.host}]: `);
  const port = await ask(rl, `  Port     [${DB_CONFIG.port}]: `);
  const user = await ask(rl, `  User     [${DB_CONFIG.user}]: `);
  const pass = await ask(rl, `  Password [${DB_CONFIG.password ? '****' : '(trống)'}]: `);
  const db = await ask(rl, `  Database [${DB_CONFIG.database}]: `);

  if (host.trim()) DB_CONFIG.host = host.trim();
  if (port.trim()) DB_CONFIG.port = parseInt(port.trim());
  if (user.trim()) DB_CONFIG.user = user.trim();
  if (pass.trim()) DB_CONFIG.password = pass.trim();
  if (db.trim()) DB_CONFIG.database = db.trim();
}

async function promptFile(rl) {
  console.log('\n📁 File danh sách từ (1 từ / dòng):');
  const listDir = path.join(__dirname, '..', 'ListWord');
  let options = [];
  if (fs.existsSync(listDir)) {
    options = fs.readdirSync(listDir).filter(f => f.endsWith('.txt'));
    if (options.length) {
      console.log('  Các file có sẵn trong ListWord/:');
      options.forEach((f, i) => console.log(`    [${i + 1}] ${f}`));
    }
  }
  const input = await ask(rl, '  Nhập số hoặc tên file (abc / abc.txt / ListWord/ABC.txt): ');
  return resolveWordFile(input.trim(), listDir, options);
}

function resolveWordFile(input, listDir, options) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const idx = parseInt(input) - 1;
    if (options[idx]) return path.join(listDir, options[idx]);
  }
  if (path.isAbsolute(input) || input.includes('/') || input.includes('\\')) {
    const full = path.resolve(__dirname, '..', input);
    if (fs.existsSync(full)) return full;
    const withExt = full.endsWith('.txt') ? full : full + '.txt';
    if (fs.existsSync(withExt)) return withExt;
    return full;
  }
  const nameInput = input.endsWith('.txt') ? input : input + '.txt';
  const matched = options.find(f => f.toLowerCase() === nameInput.toLowerCase());
  if (matched) return path.join(listDir, matched);
  return path.resolve(__dirname, '..', input);
}

// ─────────────────────────────────────────────────────────────
// 8. MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const argFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const argStart = args.includes('--start') ? parseInt(args[args.indexOf('--start') + 1]) : 0;
  const argWord = args.includes('--word') ? args[args.indexOf('--word') + 1] : null;
  const argSkipExisting = args.includes('--skip-existing');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── Cấu hình DB ──────────────────────────────────────────
  const hasEnvConfig = process.env.PG_USERNAME || process.env.PG_USER;
  if (hasEnvConfig) {
    console.log(
      `\n✅ Đọc config từ .env: ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database} (schema: ${PG_SCHEMA})`
    );
  } else {
    await promptConfig(rl);
  }

  // ── Kết nối DB ───────────────────────────────────────────
  console.log('\n🔌 Kết nối PostgreSQL...');
  const pool = new Pool(DB_CONFIG);
  try {
    await pool.query('SELECT 1');
    console.log('✅ Kết nối thành công!\n');
  } catch (err) {
    console.error('❌ Không kết nối được PostgreSQL:', err.message);
    rl.close();
    process.exit(1);
  }

  // ── Chế độ crawl 1 từ ────────────────────────────────────
  if (argWord) {
    console.log(`\n🔍 Crawl từ: "${argWord}"`);
    await crawlAndSave(pool, argWord.trim().toLowerCase());
    await pool.end();
    rl.close();
    return;
  }

  // ── Chọn file ────────────────────────────────────────────
  const listDir = path.join(__dirname, '..', 'ListWord');
  const listOptions = fs.existsSync(listDir)
    ? fs.readdirSync(listDir).filter(f => f.endsWith('.txt'))
    : [];

  let wordFile = argFile ? resolveWordFile(argFile, listDir, listOptions) : await promptFile(rl);

  if (!fs.existsSync(wordFile)) {
    console.error(`❌ File không tồn tại: ${wordFile}`);
    rl.close();
    process.exit(1);
  }

  rl.close();

  // ── Đọc danh sách từ ─────────────────────────────────────
  const allWords = fs
    .readFileSync(wordFile, 'utf8')
    .split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0);

  console.log(`\n📖 File: ${wordFile}`);
  console.log(`📊 Tổng số từ: ${allWords.length}`);

  const progress = loadProgress(wordFile);
  console.log(
    `💾 Đã crawl trước đó: ${progress.done.length} từ | Thất bại: ${progress.failed.length} từ`
  );

  const doneSet = new Set(progress.done);
  const failedSet = new Set(progress.failed);

  let words = allWords.slice(argStart);
  if (argSkipExisting) {
    words = words.filter(w => !doneSet.has(w));
  }

  const total = words.length;
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  console.log(`\n🚀 Bắt đầu crawl ${total} từ...\n`);
  console.log('─'.repeat(60));

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const idx = argStart + i + 1;

    if (doneSet.has(word)) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${idx}/${allWords.length}] "${word}" ... `);

    if (argSkipExisting && (await wordExists(pool, word))) {
      console.log('⏭  đã có trong DB');
      progress.done.push(word);
      doneSet.add(word);
      skipped++;
      saveProgress(wordFile, progress);
      continue;
    }

    let meanings = null;
    let retries = 0;

    while (retries < MAX_RETRIES && !meanings) {
      try {
        meanings = await crawlWord(word);
      } catch (err) {
        retries++;
        if (retries < MAX_RETRIES) {
          process.stdout.write(`⚠️  lỗi (${err.message}), retry ${retries}/${MAX_RETRIES}... `);
          await sleep(DELAY_ON_RETRY_MS);
        }
      }
    }

    if (!meanings || meanings.length === 0) {
      console.log('❌ không tìm thấy / không có nghĩa hợp lệ');
      progress.failed.push(word);
      failedSet.add(word);
      failed++;
      saveProgress(wordFile, progress);
      await sleep(DELAY_BETWEEN_WORDS_MS);
      continue;
    }

    process.stdout.write(`📝 ${meanings.length} nghĩa → dịch... `);
    meanings = await translateAllDefinitions(meanings);

    try {
      const { wordId, insertedIds, lockedCount } = await saveWord(pool, word, meanings);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (((i + 1) / (elapsed || 1)) * 60).toFixed(1);
      const eta = Math.round((total - i - 1) / ((i + 1) / (elapsed || 1)));
      const lockedNote = lockedCount > 0 ? ` (giữ ${lockedCount} nghĩa cũ đang được học)` : '';

      console.log(
        `✅ id=${wordId} | ${meanings.length} nghĩa${lockedNote} | ${success + 1}/${total} | ${rate} từ/phút | ETA: ${fmtSec(eta)}`
      );

      progress.done.push(word);
      doneSet.add(word);
      const fi = progress.failed.indexOf(word);
      if (fi !== -1) progress.failed.splice(fi, 1);

      success++;
      saveProgress(wordFile, progress);
    } catch (err) {
      console.log(`❌ lỗi DB: ${err.message}`);
      progress.failed.push(word);
      failed++;
      saveProgress(wordFile, progress);
    }

    await sleep(DELAY_BETWEEN_WORDS_MS);
  }

  // ── Tổng kết ─────────────────────────────────────────────
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(60));
  console.log('📊 KẾT QUẢ CRAWL:');
  console.log(`   ✅ Thành công : ${success}`);
  console.log(`   ⏭  Đã có sẵn : ${skipped}`);
  console.log(`   ❌ Thất bại   : ${failed}`);
  console.log(`   ⏱  Thời gian  : ${fmtSec(parseFloat(totalSec))}`);
  if (failed > 0) {
    console.log(`\n   Từ thất bại: ${progress.failed.join(', ')}`);
    console.log(`   → Chạy lại: node pg/crawl-words-pg.js --file ${wordFile}`);
  }
  console.log('═'.repeat(60));

  await pool.end();
}

function fmtSec(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

async function crawlAndSave(pool, word) {
  console.log(`  Crawl Cambridge...`);
  let meanings;
  try {
    meanings = await crawlWord(word);
  } catch (err) {
    console.error(`  ❌ Crawl lỗi: ${err.message}`);
    return;
  }

  if (!meanings || meanings.length === 0) {
    console.log('  ❌ Không tìm thấy từ hoặc không có nghĩa hợp lệ');
    return;
  }

  console.log(`  📝 Tìm thấy ${meanings.length} nghĩa, đang dịch...`);
  meanings = await translateAllDefinitions(meanings);

  try {
    const { wordId, insertedIds, lockedCount } = await saveWord(pool, word, meanings);
    const lockedNote =
      lockedCount > 0 ? ` (giữ nguyên ${lockedCount} nghĩa cũ đang được user học)` : '';
    console.log(`  ✅ Đã lưu: word_id=${wordId}, ${meanings.length} meanings mới${lockedNote}`);
    meanings.forEach((m, i) => {
      console.log(`    [${i + 1}] (${m.pos || '?'}) ${m.definition.substring(0, 60)}...`);
      console.log(`         VN: ${m.vnDefinition || '(chưa dịch)'}`);
    });
  } catch (err) {
    console.error(`  ❌ Lỗi DB: ${err.message}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
