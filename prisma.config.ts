import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const nodeEnv = process.env.NODE_ENV || 'development';

const datasourceMap = {
  development: env('DATABASE_URL_DEV'),
  test: env('DATABASE_URL_TEST'),
  production: env('DATABASE_URL_PROD'),
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: datasourceMap[nodeEnv] || datasourceMap['development'],
  },
});
