import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const isDev = process.env.NODE_ENV === 'development';
    const connectionString = isDev ? process.env.DATABASE_URL_DEV! : process.env.DATABASE_URL_PROD!;
    const pool = new PrismaPg({ connectionString }, { schema: 'vocab' });
    super({ adapter: pool });
  }
  async onModuleInit() {
    // Note: this is optional
    await this.$connect();
  }
}
