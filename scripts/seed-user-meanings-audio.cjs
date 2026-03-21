const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { v2: cloudinary } = require('cloudinary');

function clean(value) {
  return String(value ?? '').trim();
}

function mask(value) {
  const raw = clean(value);
  if (!raw) return 'missing';
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}${'*'.repeat(raw.length - 8)}${raw.slice(-4)}`;
}

function cloudinaryFolder() {
  return clean(process.env.CLOUDINARY_TTS_FOLDER) || 'vocab/tts';
}

function getMonthTag(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function pickLeastUsedProfile(profiles) {
  return [...profiles].sort((a, b) => {
    const aRemaining = Number.isFinite(a.remainingCredits)
      ? a.remainingCredits
      : -1;
    const bRemaining = Number.isFinite(b.remainingCredits)
      ? b.remainingCredits
      : -1;

    if (aRemaining !== bRemaining) {
      return bRemaining - aRemaining;
    }

    if (a.usageCount !== b.usageCount) {
      return a.usageCount - b.usageCount;
    }

    if (a.failCount !== b.failCount) {
      return a.failCount - b.failCount;
    }

    return a.id - b.id;
  });
}

function parseRemainingCreditsFromError(message) {
  const text = clean(message);
  const match = text.match(/You have\s+(\d+)\s+credits remaining/i);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

async function fetchRemainingCredits(apiKey) {
  const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    method: 'GET',
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  const count = Number(data?.character_count);
  const limit = Number(data?.character_limit);

  if (!Number.isFinite(count) || !Number.isFinite(limit)) {
    return null;
  }

  return Math.max(0, limit - count);
}

function classifyElevenLabsError(message) {
  const text = clean(message).toLowerCase();

  if (text.includes('quota_exceeded')) {
    return 'quota_exceeded';
  }

  if (text.includes('payment_required') || text.includes('paid_plan_required')) {
    return 'payment_required';
  }

  if (text.includes('invalid_api_key') || text.includes('unauthorized')) {
    return 'invalid_api_key';
  }

  if (text.includes('invalid_uid') || text.includes('model_not_found')) {
    return 'invalid_model_or_voice';
  }

  return 'other';
}

async function generateFromElevenLabs({ text, apiKey, voiceId, modelId }) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs failed status=${response.status} body=${body || response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function uploadToCloudinary({ audioBuffer, meaningId, folder }) {
  const publicId = `meaning-${meaningId}-${Date.now()}`;

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder,
        public_id: publicId,
        format: 'mp3',
      },
      (error, uploaded) => {
        if (error || !uploaded) {
          reject(error || new Error('Cloudinary upload failed'));
          return;
        }
        resolve(uploaded);
      },
    );

    stream.end(audioBuffer);
  });

  return result;
}

async function loadProfiles(prisma, userId) {
  const userConfigs = await prisma.userTtsConfig.findMany({
    where: { userId, isActive: true },
    include: { voiceModels: true },
    orderBy: { createdAt: 'asc' },
  });

  const globalConfigs = await prisma.userTtsConfig.findMany({
    where: { userId: null, isActive: true },
    include: { voiceModels: true },
    orderBy: { createdAt: 'asc' },
  });

  const sourceConfigs = [...userConfigs, ...globalConfigs];

  const profiles = sourceConfigs.flatMap((config) =>
    config.voiceModels
      .map((voiceModel) => ({
        id: voiceModel.id,
        configId: config.id,
        configName: config.name,
        apiKey: clean(config.apiKey),
        voiceId: clean(voiceModel.voiceId),
        modelId: clean(voiceModel.modelId),
        usageCount: 0,
        successCount: 0,
        failCount: 0,
        remainingCredits: null,
      }))
      .filter((profile) => profile.apiKey && profile.voiceId && profile.modelId),
  );

  const seen = new Set();
  const deduped = profiles.filter((profile) => {
    if (seen.has(profile.id)) {
      return false;
    }
    seen.add(profile.id);
    return true;
  });

  const now = new Date();
  const monthTag = getMonthTag(now);
  const uniqueConfigs = new Map();

  for (const profile of deduped) {
    if (!uniqueConfigs.has(profile.configId)) {
      uniqueConfigs.set(profile.configId, {
        configId: profile.configId,
        apiKey: profile.apiKey,
      });
    }
  }

  const configToRemaining = new Map();

  await Promise.all(
    [...uniqueConfigs.values()].map(async (item) => {
      const remaining = await fetchRemainingCredits(item.apiKey);
      configToRemaining.set(item.configId, remaining);
      await prisma.userTtsConfig.update({
        where: { id: item.configId },
        data: {
          remainingCredits: remaining,
          remainingCreditsMonth: monthTag,
          creditsCheckedAt: now,
        },
      });
    }),
  );

  for (const profile of deduped) {
    profile.remainingCredits = configToRemaining.get(profile.configId) ?? null;
    profile.blocked = false;
  }

  return deduped;
}

async function loadPendingMeanings(prisma, userId) {
  const userWords = await prisma.userWord.findMany({
    where: { userId },
    include: {
      wordMeaning: {
        include: { word: true },
      },
    },
    orderBy: { addedAt: 'asc' },
  });

  return userWords
    .map((item) => item.wordMeaning)
    .filter((meaning) => !meaning.ttsAudioUrl)
    .map((meaning) => ({
      id: meaning.id,
      definition: clean(meaning.definition),
      word: meaning.word.word,
    }));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const targetSchema = clean(process.env.DB_SCHEMA) || 'vocabnew';
  const targetUserId = Number(clean(process.env.SEED_USER_ID) || '2');

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error('SEED_USER_ID must be a positive integer');
  }

  const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME);
  const cloudKey = clean(process.env.CLOUDINARY_API_KEY);
  const cloudSecret = clean(process.env.CLOUDINARY_API_SECRET);

  if (!cloudName || !cloudKey || !cloudSecret) {
    throw new Error('Missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET');
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: cloudKey,
    api_secret: cloudSecret,
    secure: true,
  });

  const adapter = new PrismaPg(
    { connectionString: process.env.DATABASE_URL },
    { schema: targetSchema },
  );
  const prisma = new PrismaClient({ adapter });

  try {
    const profiles = await loadProfiles(prisma, targetUserId);
    if (!profiles.length) {
      throw new Error(`No active TTS profile found in DB for userId=${targetUserId} (or global system default)`);
    }

    const pending = await loadPendingMeanings(prisma, targetUserId);
    if (!pending.length) {
      console.log(`[seed:user-audio] nothing to do userId=${targetUserId} (all meanings already have ttsAudioUrl)`);
      return;
    }

    console.log(`[seed:user-audio] start schema=${targetSchema} userId=${targetUserId} pending=${pending.length} profiles=${profiles.length}`);
    console.log(
      `[seed:user-audio] cloudinary cloud=${cloudName} key=${mask(cloudKey)} folder=${cloudinaryFolder()}`,
    );

    let success = 0;
    let failed = 0;
    const configStats = new Map();

    for (const profile of profiles) {
      if (!configStats.has(profile.configId)) {
        configStats.set(profile.configId, {
          success: 0,
          fail: 0,
          remainingCredits: profile.remainingCredits,
        });
      }
    }

    for (const [index, meaning] of pending.entries()) {
      if (!meaning.definition) {
        console.log(`[seed:user-audio] skip ${index + 1}/${pending.length} meaning=${meaning.id} reason=empty_definition`);
        continue;
      }

      const orderedProfiles = pickLeastUsedProfile(
        profiles.filter((profile) => !profile.blocked),
      );

      if (!orderedProfiles.length) {
        console.log('[seed:user-audio] no available profiles left (all blocked), stopping early');
        break;
      }
      let done = false;
      let lastError = null;

      for (const profile of orderedProfiles) {
        profile.usageCount += 1;
        try {
          const audioBuffer = await generateFromElevenLabs({
            text: meaning.definition,
            apiKey: profile.apiKey,
            voiceId: profile.voiceId,
            modelId: profile.modelId,
          });

          const uploaded = await uploadToCloudinary({
            audioBuffer,
            meaningId: meaning.id,
            folder: cloudinaryFolder(),
          });

          await prisma.wordMeaning.updateMany({
            where: { id: meaning.id, ttsAudioUrl: null },
            data: {
              ttsAudioUrl: uploaded.secure_url,
              ttsPublicId: uploaded.public_id,
            },
          });

          profile.successCount += 1;
          success += 1;
          done = true;

          const stat = configStats.get(profile.configId);
          stat.success += 1;

          console.log(
            `[seed:user-audio] ok ${index + 1}/${pending.length} meaning=${meaning.id} word=${meaning.word} profile=${profile.id}/${profile.configName} model=${profile.modelId}`,
          );
          break;
        } catch (error) {
          profile.failCount += 1;
          const stat = configStats.get(profile.configId);
          stat.fail += 1;

          const errorType = classifyElevenLabsError(error.message);
          const remainingCredits = parseRemainingCreditsFromError(error.message);
          if (remainingCredits !== null) {
            profile.remainingCredits = remainingCredits;
            stat.remainingCredits = remainingCredits;
          }

          if (errorType === 'quota_exceeded' || errorType === 'payment_required' || errorType === 'invalid_api_key') {
            profile.blocked = true;
          }

          lastError = error;
          console.log(
            `[seed:user-audio] retry meaning=${meaning.id} profile=${profile.id}/${profile.configName} error=${error.message}`,
          );
        }
      }

      if (!done) {
        failed += 1;
        console.log(
          `[seed:user-audio] failed ${index + 1}/${pending.length} meaning=${meaning.id} lastError=${lastError?.message ?? 'unknown'}`,
        );
      }
    }

    console.log(`[seed:user-audio] done success=${success} failed=${failed}`);

    const now = new Date();
    const monthTag = getMonthTag(now);

    await Promise.all(
      [...configStats.entries()].map(([configId, stat]) =>
        prisma.userTtsConfig.update({
          where: { id: configId },
          data: {
            ttsFetchCount: { increment: stat.success },
            ttsFetchFailedCount: { increment: stat.fail },
            remainingCredits: stat.remainingCredits ?? null,
            remainingCreditsMonth: monthTag,
            creditsCheckedAt: now,
          },
        }),
      ),
    );

    const usage = profiles
      .map(
        (profile) =>
          `${profile.id}:${profile.configName} remain=${profile.remainingCredits ?? 'unknown'} usage=${profile.usageCount} ok=${profile.successCount} fail=${profile.failCount} blocked=${profile.blocked ? 'yes' : 'no'}`,
      )
      .join(' | ');

    console.log(`[seed:user-audio] profile-usage ${usage}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed:user-audio] failed:', error.message);
  process.exit(1);
});
