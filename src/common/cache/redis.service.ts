import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client?: Redis;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
    } else {
      this.logger.warn(
        'REDIS_URL is not configured; Google Drive cache is disabled.',
      );
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.client) {
      return undefined;
    }

    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const value = await this.client.get(key);
      return value ? (JSON.parse(value) as T) : undefined;
    } catch (error) {
      this.logger.error(`Redis GET failed for key ${key}`, error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number) {
    if (!this.client) {
      return;
    }

    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.error(`Redis SET failed for key ${key}`, error);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
