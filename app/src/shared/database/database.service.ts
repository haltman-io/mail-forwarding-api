import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPool, type Pool, type PoolConnection } from "mariadb";

import { AppLogger } from "../logging/app-logger.service.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T> {
    const pool = this.getPool();
    let connection: PoolConnection | undefined;

    try {
      connection = await pool.getConnection();
      return (await connection.query(sql, [...params])) as T;
    } catch (error) {
      this.logger.error("db.query.error", {
        err: error,
        sql,
        params_count: params.length,
      });
      throw error;
    } finally {
      if (connection) {
        await connection.release();
      }
    }
  }

  async withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    let connection: PoolConnection | undefined;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch {
          this.logger.warn("db.rollback.error");
        }
      }
      throw error;
    } finally {
      if (connection) {
        await connection.release();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const databaseConfig = this.configService.getOrThrow<{
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      connectionLimit: number;
      acquireTimeout: number;
      idleTimeout: number;
      minimumIdle: number;
    }>("database");

    this.pool = createPool({
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database,
      connectionLimit: databaseConfig.connectionLimit,
      acquireTimeout: databaseConfig.acquireTimeout,
      idleTimeout: databaseConfig.idleTimeout,
      minimumIdle: databaseConfig.minimumIdle,
    });

    this.logger.info("db.pool.created", {
      host: databaseConfig.host,
      port: databaseConfig.port,
      database: databaseConfig.database,
      user: databaseConfig.user,
      connectionLimit: databaseConfig.connectionLimit,
    });

    return this.pool;
  }
}
