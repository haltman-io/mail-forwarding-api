import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";

import { AppLogger } from "../logging/app-logger.service.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClientType | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  isConfigured(): boolean {
    const redisConfig = this.configService.getOrThrow<{ url: string }>("redis");
    return Boolean(redisConfig.url);
  }

  async getClient(): Promise<RedisClientType | null> {
    if (!this.isConfigured()) return null;
    if (this.client) return this.client;

    const redisConfig = this.configService.getOrThrow<{
      url: string;
      connectTimeoutMs: number;
    }>("redis");

    this.client = createClient({
      url: redisConfig.url,
      socket: {
        connectTimeout: redisConfig.connectTimeoutMs,
      },
    });

    this.client.on("error", (error) => {
      this.logger.error("redis.error", { err: error });
    });

    await this.client.connect();
    this.logger.info("redis.connected");

    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
