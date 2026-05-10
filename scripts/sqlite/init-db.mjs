import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const sqlitePath = process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'local/dev.sqlite');
const sqlPath = path.resolve(process.cwd(), 'scripts/sqlite/init.sql');

await mkdir(path.dirname(sqlitePath), { recursive: true });
const sql = await readFile(sqlPath, 'utf8');

const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
await db.exec(sql);
await db.close();

console.log(`SQLite initialized at ${sqlitePath}`);
