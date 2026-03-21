const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const ELEVENLABS_APIS = [
  {
    //vtd262002
    id: 'el_1',
    name: 'ElevenLabs – Key 1',
    apiKey: '5a5452a6443b88bbb4f623b128d870806885af083c2228abc46f5db0cadd830b',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    enabled: true,
  },
  {
    //vutrandung02062002
    id: 'el_2',
    name: 'ElevenLabs – Key 2',
    apiKey: '248030eb98108f20b985c33d42d53b52c005579769e5120f90c440750073f010',
    voiceId: 'TxGEqnHWrfWFTfGW9XjX',
    enabled: true,
  },
  {
    //kyanchanh266
    id: 'el_3',
    name: 'ElevenLabs – Key 3',
    apiKey: 'f376a5f4115762fbbe143209d4cfa99772187fdf1eaf3a161ebdda24d913819e',
    voiceId: 'ErXwobaYiN019PkySvjV',
    enabled: true,
  },
    {
    //devvu
    id: 'el_4',
    name: 'ElevenLabs – Key 4',
    apiKey: 'sk_17a9bbfbb9249a4ba43a6f42ad0105b6393ad966ef91cd1e',
    voiceId: 'ErXwobaYiN019PkySvjV',
    enabled: true,
  },
    {
    //kyanchanh2666
    id: 'el_5',
    name: 'ElevenLabs – Key 5',
    apiKey: 'sk_326bf8f73d97a6a43e720c101ad8c587290f8b0daa320390',
    voiceId: 'ErXwobaYiN019PkySvjV',
    enabled: true,
  },
    {
    //kyanchanh1604
    id: 'el_6',
    name: 'ElevenLabs – Key 6',
    apiKey: 'sk_efe02966f800f98d820f1d4e3452df73c0b25b96f2709661',
    voiceId: 'ErXwobaYiN019PkySvjV',
    enabled: true,
  },
];

function mask(value) {
  if (!value) return 'missing';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

function parseConfigsFromEnv() {
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
  const fromConstant = ELEVENLABS_APIS.filter(
    (item) => item.enabled && item.apiKey,
  ).map((item, index) => ({
    id: item.id,
    name: item.name,
    apiKey: item.apiKey,
    isActive: true,
    isSystemDefault: index === 0,
    voiceModels: [
      {
        label: `${item.name} Voice`,
        voiceId: item.voiceId,
        modelId,
        isDefault: true,
      },
    ],
  }));

  if (fromConstant.length > 0) {
    return fromConstant;
  }

  const rawJson = process.env.TTS_CONFIGS_JSON;

  if (rawJson) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      throw new Error('TTS_CONFIGS_JSON is invalid JSON');
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('TTS_CONFIGS_JSON must be a non-empty array');
    }

    return parsed.map((item, index) => {
      if (!item?.name || !item?.apiKey) {
        throw new Error(`TTS_CONFIGS_JSON[${index}] requires name and apiKey`);
      }

      const voiceModels = Array.isArray(item.voiceModels) ? item.voiceModels : [];
      if (!voiceModels.length) {
        throw new Error(`TTS_CONFIGS_JSON[${index}] requires at least one voiceModels item`);
      }

      return {
        name: String(item.name),
        apiKey: String(item.apiKey),
        isActive: item.isActive ?? true,
        isSystemDefault: item.isSystemDefault ?? false,
        voiceModels: voiceModels.map((voice, vmIndex) => {
          if (!voice?.voiceId) {
            throw new Error(`TTS_CONFIGS_JSON[${index}].voiceModels[${vmIndex}] missing voiceId`);
          }
          return {
            label: String(voice.label ?? `voice-${vmIndex + 1}`),
            voiceId: String(voice.voiceId),
            modelId: String(voice.modelId ?? 'eleven_multilingual_v2'),
            isDefault: voice.isDefault ?? vmIndex === 0,
          };
        }),
      };
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    throw new Error(
      'Missing seed input: set ELEVENLABS_APIS in scripts/seed-tts-configs.cjs, or set TTS_CONFIGS_JSON, or set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID',
    );
  }

  return [
    {
      name: process.env.TTS_DEFAULT_NAME ?? 'Shared ElevenLabs Key',
      apiKey,
      isActive: true,
      isSystemDefault: true,
      voiceModels: [
        {
          label: process.env.TTS_DEFAULT_VOICE_LABEL ?? 'Default Voice',
          voiceId,
          modelId,
          isDefault: true,
        },
      ],
    },
  ];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const targetSchema = process.env.DB_SCHEMA ?? 'vocabnew';
  const adapter = new PrismaPg(
    { connectionString: process.env.DATABASE_URL },
    { schema: targetSchema },
  );
  const prisma = new PrismaClient({ adapter });

  const configs = parseConfigsFromEnv();

  try {
    for (const [index, config] of configs.entries()) {
      const existing = await prisma.userTtsConfig.findFirst({
        where: {
          userId: null,
          name: config.name,
          provider: 'elevenlabs',
        },
      });

      const isSystemDefault = config.isSystemDefault ?? index === 0;
      let savedConfig;

      if (existing) {
        savedConfig = await prisma.userTtsConfig.update({
          where: { id: existing.id },
          data: {
            apiKey: config.apiKey,
            isActive: config.isActive ?? true,
            isSystemDefault,
          },
        });
      } else {
        savedConfig = await prisma.userTtsConfig.create({
          data: {
            userId: null,
            name: config.name,
            provider: 'elevenlabs',
            apiKey: config.apiKey,
            isActive: config.isActive ?? true,
            isSystemDefault,
          },
        });
      }

      await prisma.userTtsVoiceModel.deleteMany({
        where: { configId: savedConfig.id },
      });

      await prisma.userTtsVoiceModel.createMany({
        data: config.voiceModels.map((voiceModel, vmIndex) => ({
          configId: savedConfig.id,
          label: voiceModel.label,
          voiceId: voiceModel.voiceId,
          modelId: voiceModel.modelId,
          isDefault: voiceModel.isDefault ?? vmIndex === 0,
        })),
      });

      console.log(
        `[seed:tts] upserted config id=${savedConfig.id} name=${savedConfig.name} key=${mask(config.apiKey)} voiceModels=${config.voiceModels.length}`,
      );
    }

    const defaultCount = await prisma.userTtsConfig.count({
      where: {
        userId: null,
        isActive: true,
        isSystemDefault: true,
        provider: 'elevenlabs',
      },
    });

    if (defaultCount === 0) {
      throw new Error('At least one active isSystemDefault=true global config is required');
    }

    console.log(`[seed:tts] done. schema=${targetSchema}, configs=${configs.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed:tts] failed:', error.message);
  process.exit(1);
});
