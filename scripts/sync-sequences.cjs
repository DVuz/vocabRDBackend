const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const DEFAULT_SCHEMAS = ['vocabnew', 'vocab'];

function parseSchemas() {
  const input = process.env.SEQUENCE_SYNC_SCHEMAS;
  const schemas = (input ? input.split(',') : DEFAULT_SCHEMAS)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value));

  if (schemas.length === 0) {
    return DEFAULT_SCHEMAS;
  }

  return [...new Set(schemas)];
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[sync:sequences] Skip: DATABASE_URL is missing');
    return;
  }

  const schemas = parseSchemas();
  const adapter = new PrismaPg(
    { connectionString: process.env.DATABASE_URL },
    { schema: schemas[0] },
  );
  const prisma = new PrismaClient({ adapter });

  try {
    const schemaListSql = schemas.map((schema) => `'${schema}'`).join(', ');

    const targets = await prisma.$queryRawUnsafe(`
      SELECT
        c.table_schema,
        c.table_name,
        pg_get_serial_sequence(
          format('%I.%I', c.table_schema, c.table_name),
          c.column_name
        ) AS sequence_name
      FROM information_schema.columns c
      WHERE c.column_name = 'id'
        AND c.table_schema IN (${schemaListSql})
      ORDER BY c.table_schema, c.table_name
    `);

    let syncedCount = 0;

    for (const target of targets) {
      if (!target.sequence_name) {
        continue;
      }

      const schemaName = target.table_schema;
      const tableName = target.table_name;
      const qualifiedTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
      const sequenceName = String(target.sequence_name).replace(/'/g, "''");

      await prisma.$executeRawUnsafe(`
        SELECT setval(
          '${sequenceName}',
          COALESCE((SELECT MAX(id) FROM ${qualifiedTable}), 0) + 1,
          false
        )
      `);

      syncedCount += 1;
    }

    console.log(
      `[sync:sequences] Synced ${syncedCount} sequence(s) in schema(s): ${schemas.join(', ')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[sync:sequences] Failed:', error);
  process.exit(1);
});
