import path from 'node:path';
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

function withSchema(url: string | undefined, schema: string): string | undefined {
  if (!url) {
    return undefined;
  }

  const hasQuery = url.includes('?');
  const hasSchema = /(^|[?&])schema=/.test(url);

  if (hasSchema) {
    return url.replace(/([?&])schema=[^&]*/i, `$1schema=${schema}`);
  }

  return `${url}${hasQuery ? '&' : '?'}schema=${schema}`;
}

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: {
    url: withSchema(process.env.DIRECT_URL ?? process.env.DATABASE_URL, 'vocabnew'),
  },
});
