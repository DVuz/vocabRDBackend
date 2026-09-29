/**
 * Tải audio từ Cambridge về, upload lên Supabase Storage (S3) rồi cập nhật lại URL trong bảng words.
 *
 * Chạy:  npx tsx scripts/migrate-audio.ts
 * Cần:   npm i pg @aws-sdk/client-s3 dotenv && npm i -D tsx @types/pg
 *
 * Cấu trúc file trên bucket:  {accent}/{chữ cái đầu}/{word}.mp3
 * Ví dụ:                      uk/w/woodland.mp3, us/w/woodland.mp3
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ---------- Cấu hình (đọc từ .env) ----------
const SCHEMA = process.env.DB_SCHEMA ?? 'vocabd1';
const BUCKET = process.env.S3_BUCKET ?? 'vocab';
const S3_ENDPOINT = process.env.S3_ENDPOINT!; // https://<project-ref>.storage.supabase.co/storage/v1/s3
const S3_REGION = process.env.S3_REGION ?? 'ap-southeast-1';
// URL public để lưu vào DB (bucket phải để Public)
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  `https://${new URL(S3_ENDPOINT).hostname.split('.')[0]}.supabase.co/storage/v1/object/public/${BUCKET}`;

const DELAY_MS = Number(process.env.DELAY_MS ?? 300); // nghỉ giữa các lần tải để tránh bị chặn
const MAX_RETRY = Number(process.env.MAX_RETRY ?? 3);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined; // chạy thử vài từ
const DRY_RUN = process.env.DRY_RUN === 'true';

const ACCENTS = [
  { accent: 'uk', column: 'uk_audio_url' },
  { accent: 'us', column: 'us_audio_url' },
] as const;

// ---------- Khởi tạo client ----------
const connectionString = (process.env.DATABASE_URL ?? '').replace(/[?&]pgbouncer=true/, '');
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Supabase pooler yêu cầu SSL
  max: 1,
});

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true, // Supabase S3 bắt buộc
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

// ---------- Helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slugify(word: string): string {
  return (
    word
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
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
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

async function download(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        Range: 'bytes=0-',
        Referer: 'https://dictionary.cambridge.org/',
        'Sec-Fetch-Dest': 'audio',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cookie': 'amp-access=amp-LYimb8ZmjonVohLS6dEAjQ; preferredDictionaries="english,british-grammar,english-french,french-english"; _ga=GA1.3.1888409779.1741054969; _hjSessionUser_2790984=eyJpZCI6ImFjYWExY2RmLWY3MjktNTZjYy1hMTVmLTdmMmNiY2VlMDM3ZiIsImNyZWF0ZWQiOjE3NDEwNTQ5NjgzMjIsImV4aXN0aW5nIjp0cnVlfQ==; gig_bootstrap_4_5rnY1vVhTXaiyHmFSwS_Lw=_gigya_ver4; hasloggedin=1; beta-redesign=active; connectId={"ttl":86400000,"lastUsed":1761911282474,"lastSynced":1761911282474}; _pubcid=43b923a5-fbf5-4399-821b-7ef099acb5a0; _cc_id=709b3cfabf64361aa7e030116865dafb; _twpid=tw.1772435748729.265042544163707878; _ga_L9GCR21SZ7=GS2.3.s1773410851$o30$g1$t1773410854$j57$l0$h0; cf_clearance=LLDkqlpj2xJd6aDAfJa1l2Kj6D5KNrX_NDKgxjydTnY-1773411464-1.2.1.1-gcmmvwU3JlILzUGGZDM094_1dWymXpWPyz3sYfTkg0HXeK_TsxncTVOvy8Ui0TIieJpf3PNir2hbZfswZKKgR.vRVSgJnb8g2TDZKL9KHwHZNUVx.eKUHCG3butDPNEhuCQMCEpMvy8H9sqNxh6c_9U6PXFDPJe36sI1IG1reenVFJZKaX7eoFcO40yyBV3MExnacTQ1kGKfZOh.cIUc55zgZvNvNRsVtBF8WrClscU; cto_bundle=8RwQeV9QSkhIZjFnb1pMNGt1TU9ORUlpMG5Kb2pya2paZXRKU3JSQVZhZEw5VThTRGp5N2hQYUpkMEhveUNSNk9MdFBVbEhYcGpQbEFiRzdsTUh3ZzMxNWklMkZGYWNueGhwUldra1dsV2t6eE81Y3dySTFwbklCa1BHNlJublpkRGZRSCUyRlBWb0sxbnIyZ08lMkJpalpORkZYU0I1RFElM0QlM0Q; cto_bidid=h-hnZV9FdHNWWHdhd1NFaGNsVUZacHN2a2VLZ0tuck9nSFVMa2c2UG02ZHdkbUZNUlRkdDlOTEtiaVNvaFNBMktQamZ5NzQ3QmR2RVZPaFdFYXg5cEVyWWt1TTN2QXc2NlMlMkIxdkc4VXZNNm1nTldzJTNE; OptanonAlertBoxClosed=2026-07-17T07:45:48.526Z; eupubconsent-v2=CQneoygQneoygAcABBENCoFsAP_gAAAAAChQLFtR_G__bXlr-Tb36btkeYxf99hr7sQxBgbIkm4FzLvW7JwC32EbJAyatiIKmRIAu3TBIQNlHADURUCgKIgVrTDMaESUgTNKJ6BkiBMRY2JQCFhum4pjWQCZYur_5kd0mR-N7dr-2dzyy4hnv3a9fuS1UJCcIYctDfn8ZBKS-9IE9-x8v4vw_MbpEm8eSVl9tGtp4jc6YtO6dBmxt-TyfbyPn_AAEIEAAAAEAAAAAAAABgCAAAAwIAbAAcAJwAg4BHACaAJWATaApCBT4FQgLCAWIAtwBf4DEAGLAMhAamA24BukD5APlAgIBAwCCIEKwIeASpgmWCZoSCfABQAFQAOAAeABBAC8ANQAeABFACYAFUAN4AfgBCQCGAIkARwAmgBWgDAAGGAMsAbIA5wB3AD2gH2AfoBAACKQEXARgAjUBIgEmgJ-AoMBUQFXALmAXoAxQBogDaAG4AOIAe2BHoEigJ2AUOAo8BSICmwFsALkAXYAvMBhsDIwMkAZOAy4BmYDOYGrgayA2MBtADbwG5gN1AcmA5cB44D_gIJgQYAhDBC0EL4Iegh-BH0CRUEmASZAlmBLeCXwJgATOAm4BO4dBbAAXABQAFQAOAAggBcAGoAPAAmABTACqAF0AMQAbwA_QCGAIkATQAowBWgDAAGGANEAbIA5wB3AD2gH2AfsBFAEYgI6Ak0BPwFBgKiAq4BYgC5wF5AXoAxQBtADcAHEAPMAe0A-wCEAEXwI9AkUBMgCdgFDwKPApABTYCrAFigLYAW6AuSBdgF2gLzAX0Aw0Bj0DIwMkgZOBlUDLAMuAZmAzkBpoDVYGrgawA2gBt4DdQHFgOTAcuA7IB44D6wH3AP7Af8BAECDAELQIegR2Aj6BIoCTIEqwJZwS-BMACZwE3IJ2gncOAaQAOAA8AC4AJAA0ACOAHIAOgAgEBBwEIAI4ATQA6QCVgExAJtAUmAqEBXYCxAFqALcAX-AxABiwDIQGTANGAamA2wBt0DcwN0AceA5aBzoHPgPlAfaA_YCAgEDAIHgQRAg2BCsCHgEbwJCASSAlTBMEEw4JlgmaBNgCbZCBGAAsACgALgAagBVADEAG8AYAA5wB3AEUAJSAUGAqICrgFzAMUAbQBHoCrAFigLRAXIAuwBkYDJwGcgNVAeOA_sCDAELQIegSKAmcBO4gAbAAeAGgAcgBHACxAJtAUmAsQBngDUwG2ANuAboA5YBz4D9gICAQPAg2BCsCGYEbwJJATDAmaBNgCbZKBWAAsACgAHAAeABMACqAGKAQwBEgCOAFGAK0AYAA2QB-QFRAVcAuYBigEIAIvgR6BIoCjwFNALFAWwAuwBecDIwMkAZOAzkBrADbwIAgQPAgwBCECHoEigJKgSrAl8BM4CbgE7iQBkAC4AfAB3AEAAIOARwBKwCYgE2gKTAW4Av8BiwDLAGeAN0AcsA_YCAgEEQIZgR9AkkBM0CbZSCSAAuACgAKgAcABBADIANAAeABMACqAGIAP0AhgCJAFGAK0AYAA0QBsgDnAHfAPwA_QCLAEYgI4AkQBQYCogKuAXMAvIBigDaAG4APaAfYBF8CPQJFATsAocBSECmgKbAVYAsUBbAC5AF2gLzAX0Aw2BkYGSAMngZYBlwDOYGsAayA2UBt4DdQHJgPFAeOA_sB_wEEwIMAQhAhaBDMCHIEdgI-gSKgkwCTIEqwJZwS-BMACZwE7igC4AC4AJAAXAB8AEcAJwAcgA7gB9gEAAIOAWIA14B2wD_gIQATEAm0BT4CpIFZAV2AtwBiwDJgGeANTAa9A3MDdAHLAPlAfaA_YCAgEDAIHgQbAhWBC8CHgEjQJJASVAlTBMsEzQJsATbLQDAAagDAAHcAXoA-wCmgFWAMzAeOBD0CbgE7iwAsAZYBHAEegJiATaA1MBugDlgICATNAmw.f_wAAAAAAAAA.ILFtR_G__bXlv-Tb36btkeYxf99hr7sQxBgbIsm4FzLvW7JwC32EbJEyatiIKmRIAu3TBIQNtHAjURUChKIgVrTDMaESUgTNKJ-BkiDMRY2JQCFhum4pjWQCZYur_5kd0mR-N7dr-2dzyy5hnv3a9fuS1UJicKYctHfn8ZBKS-_IU9_x-_4vw_MbpEm8eSVt9tGtt43c64tP6dpuxt-Tyfbyfv_AAEIEAAAAEAAAAAAAABgC; OTAdditionalConsentString=2~20.43.46.55.57.61.70.83.89.93.108.117.122.124.135.143.144.147.149.159.161.184.192.196.211.228.230.236.239.255.259.266.272.286.291.311.313.314.320.322.323.327.340.358.367.370.371.385.407.415.424.429.430.436.445.469.486.491.494.495.522.523.540.550.560.568.574.576.587.591.621.723.737.797.798.802.803.820.827.839.864.899.904.922.931.938.955.959.979.981.985.986.1003.1027.1031.1033.1040.1046.1047.1048.1051.1053.1067.1092.1095.1097.1099.1107.1109.1126.1135.1143.1149.1152.1162.1166.1186.1188.1192.1205.1215.1220.1226.1227.1230.1252.1268.1270.1276.1284.1290.1301.1307.1312.1329.1342.1345.1356.1365.1375.1403.1415.1416.1419.1421.1423.1440.1449.1455.1495.1512.1514.1516.1525.1540.1548.1555.1558.1567.1570.1577.1579.1583.1584.1598.1603.1616.1638.1651.1653.1659.1660.1667.1677.1678.1682.1697.1699.1712.1716.1720.1721.1725.1732.1735.1745.1750.1753.1782.1786.1800.1808.1810.1825.1827.1832.1838.1840.1843.1845.1859.1870.1878.1880.1882.1889.1898.1911.1917.1928.1929.1942.1944.1958.1962.1963.1964.1967.1968.1969.1978.1985.1987.2003.2008.2027.2035.2038.2039.2044.2047.2052.2056.2064.2068.2069.2072.2074.2084.2088.2090.2103.2107.2109.2115.2124.2130.2133.2135.2137.2140.2141.2147.2156.2166.2177.2186.2205.2213.2216.2219.2220.2222.2223.2224.2225.2227.2234.2251.2253.2271.2275.2279.2282.2295.2299.2309.2312.2316.2322.2325.2328.2331.2335.2336.2343.2354.2358.2359.2370.2373.2376.2377.2400.2403.2405.2406.2410.2411.2414.2415.2416.2418.2425.2427.2440.2447.2453.2461.2465.2468.2472.2477.2484.2486.2488.2493.2498.2501.2506.2510.2517.2526.2527.2531.2534.2535.2542.2552.2559.2564.2567.2568.2569.2571.2572.2575.2577.2579.2583.2584.2589.2595.2596.2604.2605.2609.2610.2612.2614.2621.2624.2627.2628.2629.2633.2636.2642.2643.2645.2646.2650.2651.2652.2656.2657.2658.2660.2661.2669.2670.2677.2681.2684.2687.2689.2690.2695.2698.2713.2714.2729.2739.2767.2768.2770.2772.2778.2784.2787.2791.2792.2798.2801.2805.2812.2813.2814.2816.2817.2821.2822.2824.2826.2827.2830.2831.2832.2833.2834.2838.2839.2844.2846.2849.2850.2852.2854.2860.2862.2863.2865.2867.2869.2872.2874.2875.2878.2880.2881.2882.2883.2884.2886.2887.2888.2889.2891.2893.2894.2895.2897.2898.2900.2901.2908.2909.2916.2917.2918.2920.2922.2923.2927.2929.2930.2931.2940.2941.2947.2949.2950.2956.2958.2961.2963.2964.2965.2966.2968.2972.2973.2974.2975.2979.2980.2981.2983.2985.2986.2987.2994.2995.2997.2999.3000.3001.3002.3003.3005.3008.3009.3010.3012.3016.3017.3018.3019.3023.3028.3031.3034.3038.3043.3051.3052.3053.3055.3058.3059.3063.3066.3070.3073.3074.3075.3076.3077.3089.3090.3093.3094.3095.3097.3099.3100.3106.3107.3109.3112.3117.3119.3120.3126.3127.3128.3130.3133.3135.3136.3137.3145.3149.3151.3153.3155.3165.3167.3169.3172.3173.3177.3182.3184.3185.3186.3187.3188.3189.3190.3194.3196.3200.3201.3209.3210.3213.3214.3215.3217.3218.3222.3223.3225.3226.3227.3228.3230.3231.3233.3235.3236.3237.3238.3240.3244.3250.3251.3253.3254.3257.3260.3266.3270.3272.3286.3288.3289.3290.3292.3293.3296.3299.3300.3306.3307.3309.3314.3315.3316.3318.3323.3324.3328.3330.3331.3531.3631.3731.3831.4131.4531.4631.4731.4831.5231.6931.7131.7235.7831.7931.8931.10231.10631.10831.11031.11531.11631.13431.13632.13731.14034.14133.14237.15731.16831.16931.21233.21731.23031.25131.25931.26031.26631.27731.27831.28031.28332.28731.29631.30331.30532.30732.32531.33931.34231.34631.34731.36831.39131.39531.40632.41131.41531.43631.43731.43831.45931.47232.47531.48131.49231.49332.49431.50831.52831.54231.56831.56931.57131.57231.57531.57931.58131~dv; iawsc1m=1; iawppid=22e325a222fb407fa3154410e7ebae5a; OptanonConsent=isGpcEnabled=0&datestamp=Thu+Sep+24+2026+23%3A45%3A24+GMT%2B0700+(Gi%E1%BB%9D+%C4%90%C3%B4ng+D%C6%B0%C6%A1ng)&version=202609.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1%2CV2STACK42%3A1&AwaitingReconsent=false&geolocation=VN%3B31&isDntEnabled=0&consentId=b80be1c0-6bf0-4652-81be-8ba9ba160050&interactionCount=1&isAnonUser=1&prevHadToken=0&intType=1&crTime=1784274349349; iawpvccs=2; iawpvc=214; iawpvtc1m=2; _sp_id.103f=02b3ae6f-6615-432d-bc4c-c94b8ce443dd.1747505340.32.1790268366.1773800278.c0c750a8-8b2b-4739-b8bb-8e2f88dfde11.5b9036bc-384b-4616-9ece-54e68e2851c6.279b6266-0aa5-47ab-989a-2efe07f02847.1790268321560.4; _twsid=1790268321568-407872552.1.1790268410352; cf_clearance=rv_OHsY8AZuqMrn1vFFhQD7IAz0uwsluw6tODswLrAs-1790655448-1.2.1.1-rzOFMD5UzAovS7FsMM0kEclKJ0nIYywvj4pc5JT8FgK6Gi2coo0_VZdxXsFxcQU4Z0cwynSLQkIRcx8ykKKITbViJZXFv8UFJMJ1Gj3mba8UDZ4iFu3pqFx6kcDE9hIQWJOEdZBjk07WORH3sTOK8rdL35h6Xjw.jiVFNpCTRwzMl0rkVSbNBsswp2hyTRO7mrBLAjK2y_7LhmBGPEjMzuUHh7xWc2Be7KFC.j.PnWocEMAP_iAm5rycdu_.CURAyupsY3bVmBzWT4eDGvVtoJbO.M25Fyelbxk.YG2BFw23rKZDBc5zR55fRdBXww_Pnt4cvk7ZVeMZF3un9ZspTyN1Ce3_zyFRf7UIRiRvGWyjAc5Jo0mDWUz1IJzhdSecciSV6cfYJ79yssarYBSWzcFgizEcM_99kWp6jUz0_J5XAUpD6mN3Us7nJdgBzVppogM9ymNUdtPSxjZvQUpLLdeubYkQsfoDlEQBPTi_ddRBljUlgBf9Cshm3JZ67ZOqilSsAwU9yY3xUz.lEeF79w'
      },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
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
  for (const v of ['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!process.env[v]) throw new Error(`Thiếu biến môi trường ${v}`);
  }

  const stats = { ok: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];

  for (const { accent, column } of ACCENTS) {
    // Chỉ lấy những từ còn trỏ tới nguồn ngoài => chạy lại được, tự bỏ qua các từ đã xong
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
          stats.skipped++; // đã có trên S3, chỉ cần cập nhật DB
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
  .finally(() => pool.end());