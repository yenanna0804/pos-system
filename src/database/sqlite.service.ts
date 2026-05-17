import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { DbService, QueryRow, TransactionExecutor } from './db.service';

@Injectable()
export class SqliteService extends DbService implements OnModuleInit, OnModuleDestroy {
  private db!: Database;
  private isClosed = false;
  private readonly sqlitePath = process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'local/dev.sqlite');

  async onModuleInit() {
    await mkdir(path.dirname(this.sqlitePath), { recursive: true });
    this.db = await open({ filename: this.sqlitePath, driver: sqlite3.Database });
    this.isClosed = false;
    await this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async onModuleDestroy() {
    if (!this.db || this.isClosed) return;
    try {
      await this.db.close();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('SQLITE_MISUSE')) {
        throw error;
      }
    } finally {
      this.isClosed = true;
    }
  }

  async query<T extends QueryRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const prepared = this.prepareSql(sql, params);
    const normalizedSql = prepared.sql;
    const lowered = normalizedSql.trim().toLowerCase();
    if (lowered.startsWith('select') || lowered.includes(' returning ')) {
      return this.db.all<T[]>(normalizedSql, prepared.params) as unknown as T[];
    }
    await this.db.run(normalizedSql, prepared.params);
    return [];
  }

  async withTransaction<T>(handler: (executor: TransactionExecutor) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const txExecutor: TransactionExecutor = {
        query: <R extends QueryRow>(sql: string, params: unknown[] = []) => this.query<R>(sql, params),
      };
      const result = await handler(txExecutor);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private prepareSql(sql: string, params: unknown[]) {
    let nextSql = sql;
    const indexedParams = [...params];

    nextSql = nextSql.replace(/=\s*ANY\(\$(\d+)::text\[\]\)/gi, (_full, indexText: string) => {
      const index = Number(indexText) - 1;
      const value = indexedParams[index];
      if (!Array.isArray(value)) return `= $${indexText}`;
      if (value.length === 0) return 'IN (NULL)';
      return `IN ($${indexText})`;
    });

    const finalParams: unknown[] = [];
    nextSql = nextSql.replace(/\$(\d+)/g, (_full, indexText: string) => {
      const index = Number(indexText) - 1;
      const value = indexedParams[index];
      if (Array.isArray(value)) {
        if (value.length === 0) return 'NULL';
        finalParams.push(...value);
        return value.map(() => '?').join(', ');
      }
      finalParams.push(value);
      return '?';
    });

    nextSql = nextSql
      .replace(/CAST\(\?\s+AS\s+"[^"]+"\)/gi, '?')
      .replace(/CAST\(\$(\d+)\s+AS\s+"[^"]+"\)/gi, '?')
      .replace(/::"[^"]+"/g, '')
      .replace(/::text\[\]/g, '')
      .replace(/::text/g, '')
      .replace(/::int/g, '')
      .replace(/::timestamptz/g, '')
      .replace(/NOW\(\)/gi, "datetime('now')")
      .replace(/NULLS FIRST/gi, '')
      .replace(/CONCAT_WS\('\s*\/\s*',\s*([^\)]+)\)/gi, "$1")
      .replace(/JSON_BUILD_OBJECT\(/gi, 'json_object(')
      .replace(/JSON_AGG\(/gi, 'json_group_array(')
      .replace(/json_agg\(/gi, 'json_group_array(')
      .replace(/string_agg\(([^,]+),\s*'([^']*)'\)\s*filter\s*\(where\s+[^\)]*\)/gi, 'group_concat($1, "$2")')
      .replace(/'\[\]'::json/gi, "'[]'")
      .replace(/CAST\(([^)]+)\s+AS\s+jsonb\)/gi, '$1')
      .replace(/ILIKE/gi, 'LIKE')
      .replace(/translate\(lower\(([^)]+)\),\s*'[^']*',\s*'[^']*'\)/gi, 'lower($1)');

    return { sql: nextSql, params: finalParams };
  }
}
