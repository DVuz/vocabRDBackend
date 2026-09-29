import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const schema = process.env.DB_SCHEMA ?? 'vocabd1';
    const adapter = new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL as string,
      },
      { schema },
    );
    console.log(`Database schema: ${schema}`);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
