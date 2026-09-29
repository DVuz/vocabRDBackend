/**
 * Tải audio Cambridge bằng Chrome THẬT (Playwright) để tránh Cloudflare 403,
 * upload lên Supabase Storage (S3) rồi cập nhật lại URL trong bảng words.
 *
 * Cài:   npm i playwright pg @aws-sdk/client-s3 dotenv && npm i -D tsx @types/pg
 *        (dùng Chrome đã cài sẵn trên máy, không cần tải thêm trình duyệt)
 * Chạy:  npx tsx scripts/migrate-audio-browser.ts
 *
 * Lần đầu Chrome sẽ mở ra. Nếu thấy màn hình "Verify you are human", hãy tích vào,
 * script tự chạy tiếp. Phiên được lưu trong thư mục .chrome-profile nên các lần sau không phải làm lại.
 *
 * Cấu trúc file trên bucket:  {accent}/{chữ cái đầu}/{word}.mp3
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { chromium, BrowserContext, Page } from 'playwright';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ---------- Cấu hình (đọc từ .env) ----------
for (const v of ['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) {
    console.error(`Thiếu biến môi trường ${v}. Kiểm tra file .env.`);
    process.exit(1);
  }
}

const SCHEMA = process.env.DB_SCHEMA ?? 'vocabd1';
const BUCKET = process.env.S3_BUCKET ?? 'vocab';
const S3_ENDPOINT = process.env.S3_ENDPOINT!;
const S3_REGION = process.env.S3_REGION ?? 'ap-southeast-1';
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  `https://${new URL(S3_ENDPOINT).hostname.split('.')[0]}.supabase.co/storage/v1/object/public/${BUCKET}`;

const DELAY_MS = Number(process.env.DELAY_MS ?? 500);
const MAX_RETRY = Number(process.env.MAX_RETRY ?? 3);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
const DRY_RUN = process.env.DRY_RUN === 'true';
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL ?? 'chrome'; // hoặc 'msedge'
const PROFILE_DIR = process.env.PROFILE_DIR ?? '.chrome-profile';
const SITE = 'https://dictionary.cambridge.org/';

const ACCENTS = [
  { accent: 'uk', column: 'uk_audio_url' },
  { accent: 'us', column: 'us_audio_url' },
] as const;

// ---------- Khởi tạo client ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!.replace(/[?&]pgbouncer=true/, ''),
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

// ---------- Trình duyệt ----------
let context: BrowserContext | undefined;
let page: Page;

async function waitForCloudflare(): Promise<void> {
  console.log('Nếu thấy màn hình xác minh Cloudflare, hãy tích vào. Script sẽ tự chạy tiếp (tối đa 3 phút)...');
  await page.waitForFunction(() => !/just a moment|attention required/i.test(document.title), null, {
    timeout: 180_000,
  });
}

async function initBrowser(): Promise<void> {
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: BROWSER_CHANNEL,
    headless: false, // headless dễ bị Cloudflare phát hiện
    args: ['--disable-blink-features=AutomationControlled'],
  });
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await waitForCloudflare();
  console.log('Trình duyệt sẵn sàng.\n');
}

// ---------- Helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slugify(word: string): string {
  return (
    word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function buildKey(accent: string, word: string, ext: string): string {
  const slug = slugify(word);
  const letter = /^[a-z]/.test(slug) ? slug[0] : '0-9';
  return `${accent}/${letter}/${slug}.${ext}`;
}

function getExt(url: string): string {
  const m = new URL(url).pathname.match(/\.(mp3|ogg|wav|m4a)$/i);
  return m ? m[1].toLowerCase() : 'mp3';
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
};

/** Tải file bằng fetch chạy TRONG trang Cambridge (cùng origin, dùng TLS + cookie của Chrome). */
async function download(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const result = await page.evaluate(async (u: string) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return { status: r.status, b64: '', type: '' };
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return { status: 200, b64: btoa(bin), type: r.headers.get('content-type') ?? '' };
      }, url);

      if (result.status === 403) {
        // Cookie hết hạn: nạp lại trang chủ để Cloudflare cấp lại
        await page.goto(SITE, { waitUntil: 'domcontentloaded' });
        await waitForCloudflare();
        throw new Error('HTTP 403');
      }
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      if (result.type.includes('text/html')) throw new Error('Server trả về HTML thay vì audio');

      const buf = Buffer.from(result.b64, 'base64');
      if (buf.length === 0) throw new Error('File rỗng');
      return buf;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function upload(key: string, body: Buffer, ext: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: CONTENT_TYPES[ext] ?? 'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

// ---------- Main ----------
async function main() {
  if (!DRY_RUN) await initBrowser();

  const stats = { ok: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];

  for (const { accent, column } of ACCENTS) {
    const { rows } = await pool.query<{ id: number; word: string; url: string }>(
      `SELECT id, word, ${column} AS url
         FROM ${SCHEMA}.words
        WHERE ${column} LIKE 'http%'
          AND ${column} NOT LIKE $1
        ORDER BY id
        ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
      [`${PUBLIC_BASE_URL}%`],
    );

    console.log(`\n[${accent.toUpperCase()}] ${rows.length} file cần xử lý`);

    let i = 0;
    for (const row of rows) {
      i++;
      const tag = `[${accent}] ${i}/${rows.length} ${row.word}`;
      try {
        const ext = getExt(row.url);
        const key = buildKey(accent, row.word, ext);
        const newUrl = `${PUBLIC_BASE_URL}/${key}`;

        if (DRY_RUN) {
          console.log(`${tag} -> ${key} (dry-run)`);
          continue;
        }

        if (await exists(key)) {
          stats.skipped++;
        } else {
          const data = await download(row.url);
          await upload(key, data, ext);
          await sleep(DELAY_MS);
        }

        await pool.query(
          `UPDATE ${SCHEMA}.words SET ${column} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newUrl, row.id],
        );
        stats.ok++;
        console.log(`${tag} ✓ ${key}`);
      } catch (err) {
        stats.failed++;
        const msg = `${tag} ✗ ${(err as Error).message} (${row.url})`;
        failures.push(msg);
        console.error(msg);
      }
    }
  }

  console.log(`\nXong: ${stats.ok} thành công (${stats.skipped} đã có sẵn trên S3), ${stats.failed} lỗi`);
  if (failures.length) console.log('Các file lỗi (chạy lại script để thử lại):\n' + failures.join('\n'));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await context?.close();
    await pool.end();
  });