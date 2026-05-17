import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

type QueryExecutor = {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

@Injectable()
export class PgService implements OnModuleInit, OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async withTransaction<T>(handler: (executor: { query<R extends QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]> }) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txExecutor = {
        query: async <R extends QueryResultRow>(sql: string, params: unknown[] = []) => {
          const result = await (client as QueryExecutor).query<R>(sql, params);
          return result.rows;
        },
      };
      const output = await handler(txExecutor);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
