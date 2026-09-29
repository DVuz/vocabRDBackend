/**
 * Crawl hàng loạt ~25k từ trong wordfreq-en-25000 bằng LongmanCrawlerService.
 *
 * Đặt file này ở:  scripts/crawl-wordfreq.ts   (sửa 2 import bên dưới cho đúng đường dẫn của bạn)
 * Chạy:
 *  npx ts-node -r tsconfig-paths/register scripts/crawl-wordfreq.ts
 *   (KHÔNG dùng tsx: esbuild không hỗ trợ emitDecoratorMetadata nên Nest DI sẽ lỗi)
 *
 * ENV (tuỳ chọn):
 *   CONCURRENCY=4     số từ xử lý song song (request tới Longman vẫn xếp hàng + nghỉ LONGMAN_DELAY_MS)
 *   START=0           bắt đầu từ vị trí thứ mấy trong danh sách
 *   LIMIT=100         chỉ chạy N từ (để test thử)
 *   LONGMAN_DELAY_MS=1000   nên để >= 1000 khi chạy hàng loạt
 *   WORDLIST_URL=...  nguồn danh sách khác
 *
 * Chạy lại bao nhiêu lần cũng được: từ nào đã có trong DB (word hoặc alias) sẽ bị bỏ qua.
 * Từ Longman không có được ghi vào scripts-output/not-found.txt.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module'; // ← sửa đường dẫn nếu khác
import { PrismaService } from 'src/prisma/prisma.service';
import { LongmanCrawlerService } from 'src/modules/words/services/longman-crawler.service'; // ← sửa đường dẫn

const WORDLIST_URL =
  process.env.WORDLIST_URL ??
  'https://raw.githubusercontent.com/aparrish/wordfreq-en-25000/main/wordfreq-en-25000-log.json';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const START = Number(process.env.START ?? 0);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
const MAX_BLOCK_RETRIES = 5;

const OUT_DIR = join(process.cwd(), 'scripts-output');
const CACHE_FILE = join(OUT_DIR, 'wordfreq-en-25000.json');
const NOT_FOUND_FILE = join(OUT_DIR, 'not-found.txt');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VALID_WORD = /^[a-z][a-z\s'\-.]*$/; // giống bộ lọc trong crawlAndSave

/** File gốc là mảng [word, logFreq] (hoặc mảng string) → lấy ra danh sách từ theo thứ tự tần suất */
async function loadWords(): Promise<string[]> {
  mkdirSync(OUT_DIR, { recursive: true });

  let raw: string;
  if (existsSync(CACHE_FILE)) {
    raw = readFileSync(CACHE_FILE, 'utf8');
  } else {
    console.log(`Tải danh sách từ: ${WORDLIST_URL}`);
    const res = await fetch(WORDLIST_URL);
    if (!res.ok) throw new Error(`Không tải được danh sách từ (HTTP ${res.status})`);
    raw = await res.text();
    writeFileSync(CACHE_FILE, raw);
  }

  const data = JSON.parse(raw) as unknown[];
  const seen = new Set<string>();
  const words: string[] = [];

  for (const item of data) {
    const w = (Array.isArray(item) ? item[0] : item) as unknown;
    if (typeof w !== 'string') continue;
    const word = w.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!word || word.length > 100 || !VALID_WORD.test(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const crawler = app.get(LongmanCrawlerService, { strict: false });
  const prisma = app.get(PrismaService, { strict: false });

  const all = await loadWords();
  console.log(`Danh sách hợp lệ: ${all.length} từ`);

  // Nạp trước các từ đã có (word + alias) để bỏ qua nhanh, khỏi query từng từ
  const [words, aliases] = await Promise.all([
    prisma.word.findMany({ select: { word: true } }),
    prisma.wordAlias.findMany({ select: { alias: true } }),
  ]);
  const done = new Set<string>([
    ...words.map((w) => w.word),
    ...aliases.map((a) => a.alias),
  ]);

  let todo = all.slice(START).filter((w) => !done.has(w));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`Đã có sẵn: ${all.length - todo.length}, cần crawl: ${todo.length}, concurrency=${CONCURRENCY}\n`);

  const stats = { ok: 0, notFound: 0, failed: 0 };
  const startedAt = Date.now();
  let cursor = 0;
  let processed = 0;

  async function waitIfBlocked() {
    let ms: number;
    while ((ms = crawler.getBlockedRemainingMs()) > 0) {
      console.warn(`Longman đang chặn, chờ ${Math.ceil(ms / 1000)}s...`);
      await sleep(ms + 1000);
    }
  }

  async function crawlOne(word: string): Promise<void> {
    for (let attempt = 0; attempt <= MAX_BLOCK_RETRIES; attempt++) {
      await waitIfBlocked();
      try {
        const result = await crawler.crawlAndSave(word);
        if (result) {
          stats.ok++;
          return;
        }
        // null + đang bị chặn → thử lại sau khi hết cooldown; ngược lại là "không tìm thấy"
        if (crawler.getBlockedRemainingMs() > 0) continue;
        stats.notFound++;
        appendFileSync(NOT_FOUND_FILE, word + '\n');
        return;
      } catch (err) {
        stats.failed++;
        console.error(`✗ ${word}: ${(err as Error).message}`);
        return;
      }
    }
    stats.failed++;
    console.error(`✗ ${word}: vẫn bị chặn sau ${MAX_BLOCK_RETRIES} lần thử`);
  }

  async function worker() {
    while (cursor < todo.length) {
      const word = todo[cursor++];
      await crawlOne(word);
      processed++;

      if (processed % 50 === 0 || processed === todo.length) {
        const elapsedMin = (Date.now() - startedAt) / 60000;
        const rate = processed / Math.max(elapsedMin, 0.01);
        const etaMin = (todo.length - processed) / Math.max(rate, 0.01);
        console.log(
          `[${processed}/${todo.length}] ok=${stats.ok} notFound=${stats.notFound} failed=${stats.failed} ` +
            `| ${rate.toFixed(1)} từ/phút | còn ~${(etaMin / 60).toFixed(1)}h`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nXong: ok=${stats.ok}, notFound=${stats.notFound}, failed=${stats.failed}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});